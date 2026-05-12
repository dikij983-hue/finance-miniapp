import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import type { HonoEnv } from "./types.js";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import { verifyUserToken, signUserToken } from "./auth/jwt.js";
import { validateTelegramInitData } from "./auth/telegram.js";
import {
  users,
  accounts,
  categories,
  transactions,
  budgets,
  recurringRules,
} from "./db/schema.js";
import { applyDueRecurring } from "./services/recurring.js";
import { sumExpenseForBudget, accountBalances } from "./services/budget.js";

async function reportCurrencyOf(db: Db, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return u?.reportCurrency ?? "RUB";
}

const requireUser = createMiddleware<HonoEnv>(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const v = await verifyUserToken(token, c.var.env.JWT_SECRET);
  if (!v) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", v.userId);
  await next();
});

export function createApp(db: Db, env: Env) {
  const app = new Hono<HonoEnv>();

  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("env", env);
    await next();
  });

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/auth/telegram", async (c) => {
    const d = c.var.db;
    const e = c.var.env;
    const parsed = z.object({ initData: z.string().min(1) }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    const v = validateTelegramInitData(parsed.data.initData, e.BOT_TOKEN);
    if (!v.ok) return c.json({ error: v.reason }, 401);

    const tg = v.user;
    const [existing] = await d
      .select()
      .from(users)
      .where(eq(users.telegramId, tg.id))
      .limit(1);

    let user = existing;
    if (!user) {
      const [inserted] = await d
        .insert(users)
        .values({
          telegramId: tg.id,
          firstName: tg.first_name ?? null,
          username: tg.username ?? null,
        })
        .returning();
      user = inserted;
    } else {
      await d
        .update(users)
        .set({
          firstName: tg.first_name ?? user.firstName,
          username: tg.username ?? user.username,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      const [refreshed] = await d.select().from(users).where(eq(users.id, user.id)).limit(1);
      user = refreshed ?? user;
    }

    const token = await signUserToken(user.id, e.JWT_SECRET);
    return c.json({
      token,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        reportCurrency: user.reportCurrency,
        firstName: user.firstName,
      },
    });
  });

  const authed = new Hono<HonoEnv>();
  authed.use("*", requireUser);

  authed.get("/me", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const [user] = await d.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return c.json({ error: "not_found" }, 404);
    return c.json({
      id: user.id,
      telegramId: user.telegramId,
      reportCurrency: user.reportCurrency,
      firstName: user.firstName,
    });
  });

  authed.patch("/me", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const parsed = z
      .object({ reportCurrency: z.string().min(3).max(16).optional() })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    if (parsed.data.reportCurrency) {
      await d
        .update(users)
        .set({ reportCurrency: parsed.data.reportCurrency.toUpperCase(), updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
    const [user] = await d.select().from(users).where(eq(users.id, userId)).limit(1);
    return c.json(user);
  });

  authed.post("/sync/recurring", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const n = await applyDueRecurring(d, userId);
    return c.json({ applied: n });
  });

  authed.get("/accounts", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const list = await d.select().from(accounts).where(eq(accounts.userId, userId));
    const bal = await accountBalances(d, userId);
    return c.json(
      list.map((a) => ({
        ...a,
        balanceMinor: bal.get(a.id) ?? 0,
      })),
    );
  });

  authed.post("/accounts", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const parsed = z
      .object({
        name: z.string().min(1).max(255),
        currencyCode: z.string().min(3).max(16),
        isCrypto: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const [row] = await d
      .insert(accounts)
      .values({
        userId,
        name: parsed.data.name,
        currencyCode: parsed.data.currencyCode.toUpperCase(),
        isCrypto: parsed.data.isCrypto ?? false,
      })
      .returning();
    return c.json(row, 201);
  });

  authed.patch("/accounts/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const parsed = z
      .object({
        name: z.string().min(1).max(255).optional(),
        currencyCode: z.string().min(3).max(16).optional(),
        isCrypto: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const [acc] = await d
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .limit(1);
    if (!acc) return c.json({ error: "not_found" }, 404);
    const [row] = await d
      .update(accounts)
      .set({
        name: parsed.data.name ?? acc.name,
        currencyCode: (parsed.data.currencyCode ?? acc.currencyCode).toUpperCase(),
        isCrypto: parsed.data.isCrypto ?? acc.isCrypto,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, id))
      .returning();
    return c.json(row);
  });

  authed.delete("/accounts/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const [acc] = await d
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .limit(1);
    if (!acc) return c.json({ error: "not_found" }, 404);
    await d.delete(accounts).where(eq(accounts.id, id));
    return c.body(null, 204);
  });

  authed.get("/categories", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const kind = c.req.query("kind") as "expense" | "income" | undefined;
    const list = kind
      ? await d
          .select()
          .from(categories)
          .where(and(eq(categories.userId, userId), eq(categories.kind, kind)))
      : await d.select().from(categories).where(eq(categories.userId, userId));
    return c.json(list);
  });

  authed.post("/categories", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const parsed = z
      .object({
        name: z.string().min(1).max(255),
        kind: z.enum(["expense", "income"]),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const [row] = await d
      .insert(categories)
      .values({
        userId,
        name: parsed.data.name,
        kind: parsed.data.kind,
      })
      .returning();
    return c.json(row, 201);
  });

  authed.patch("/categories/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const parsed = z
      .object({ name: z.string().min(1).max(255).optional() })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const [cat] = await d
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, userId)))
      .limit(1);
    if (!cat) return c.json({ error: "not_found" }, 404);
    const [row] = await d
      .update(categories)
      .set({ name: parsed.data.name ?? cat.name, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning();
    return c.json(row);
  });

  authed.delete("/categories/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const [cat] = await d
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, userId)))
      .limit(1);
    if (!cat) return c.json({ error: "not_found" }, 404);
    await d
      .update(categories)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(categories.id, id));
    return c.body(null, 204);
  });

  authed.get("/transactions", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const from = c.req.query("from");
    const to = c.req.query("to");
    const accountId = c.req.query("accountId");
    const filters = [eq(transactions.userId, userId)];
    if (from) filters.push(gte(transactions.occurredAt, new Date(from)));
    if (to) filters.push(lte(transactions.occurredAt, new Date(to)));
    if (accountId) filters.push(eq(transactions.accountId, accountId));
    const list = await d
      .select()
      .from(transactions)
      .where(and(...filters))
      .orderBy(desc(transactions.occurredAt))
      .limit(500);
    return c.json(list);
  });

  authed.post("/transactions", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const parsed = z
      .object({
        accountId: z.string().uuid(),
        categoryId: z.string().uuid().nullable().optional(),
        type: z.enum(["income", "expense"]),
        amountMinor: z.number().int().positive(),
        currencyCode: z.string().min(3).max(16),
        occurredAt: z.string().datetime({ offset: true }),
        note: z.string().max(2000).optional(),
        amountReportMinor: z.number().int().positive().nullable().optional(),
        reportCurrency: z.string().min(3).max(16).nullable().optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400);
    }

    const [acc] = await d
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, userId)))
      .limit(1);
    if (!acc) return c.json({ error: "account_not_found" }, 404);
    if (acc.currencyCode !== parsed.data.currencyCode.toUpperCase()) {
      return c.json({ error: "currency_mismatch_account" }, 400);
    }

    if (parsed.data.categoryId) {
      const [cat] = await d
        .select()
        .from(categories)
        .where(and(eq(categories.id, parsed.data.categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!cat) return c.json({ error: "category_not_found" }, 404);
      if (cat.kind !== parsed.data.type) {
        return c.json({ error: "category_kind_mismatch" }, 400);
      }
    }

    const reportCur = await reportCurrencyOf(d, userId);
    let amountReportMinor = parsed.data.amountReportMinor ?? null;
    let reportCurrency = parsed.data.reportCurrency?.toUpperCase() ?? null;
    if (amountReportMinor == null && reportCurrency == null) {
      if (acc.currencyCode === reportCur) {
        amountReportMinor = parsed.data.amountMinor;
        reportCurrency = reportCur;
      }
    } else if (amountReportMinor != null && reportCurrency == null) {
      reportCurrency = reportCur;
    }

    const [row] = await d
      .insert(transactions)
      .values({
        userId,
        accountId: parsed.data.accountId,
        categoryId: parsed.data.categoryId ?? null,
        type: parsed.data.type,
        amountMinor: parsed.data.amountMinor,
        currencyCode: parsed.data.currencyCode.toUpperCase(),
        amountReportMinor,
        reportCurrency,
        occurredAt: new Date(parsed.data.occurredAt),
        note: parsed.data.note ?? null,
      })
      .returning();
    return c.json(row, 201);
  });

  authed.delete("/transactions/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const [tx] = await d
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .limit(1);
    if (!tx) return c.json({ error: "not_found" }, 404);
    if (tx.exchangeGroupId) {
      await d
        .delete(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.exchangeGroupId, tx.exchangeGroupId),
          ),
        );
    } else {
      await d.delete(transactions).where(eq(transactions.id, id));
    }
    return c.body(null, 204);
  });

  authed.post("/exchanges", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const parsed = z
      .object({
        fromAccountId: z.string().uuid(),
        toAccountId: z.string().uuid(),
        amountOutMinor: z.number().int().positive(),
        amountInMinor: z.number().int().positive(),
        occurredAt: z.string().datetime({ offset: true }),
        note: z.string().max(2000).optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    if (parsed.data.fromAccountId === parsed.data.toAccountId) {
      return c.json({ error: "same_account" }, 400);
    }

    const [fromAcc] = await d
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, parsed.data.fromAccountId), eq(accounts.userId, userId)))
      .limit(1);
    const [toAcc] = await d
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, parsed.data.toAccountId), eq(accounts.userId, userId)))
      .limit(1);
    if (!fromAcc || !toAcc) return c.json({ error: "account_not_found" }, 404);

    const occurredAt = new Date(parsed.data.occurredAt);
    const groupId = crypto.randomUUID();

    await d.transaction(async (tx) => {
      await tx.insert(transactions).values({
        userId,
        accountId: parsed.data.fromAccountId,
        categoryId: null,
        type: "expense",
        amountMinor: parsed.data.amountOutMinor,
        currencyCode: fromAcc.currencyCode,
        occurredAt,
        note: parsed.data.note ?? "Exchange out",
        exchangeGroupId: groupId,
      });
      await tx.insert(transactions).values({
        userId,
        accountId: parsed.data.toAccountId,
        categoryId: null,
        type: "income",
        amountMinor: parsed.data.amountInMinor,
        currencyCode: toAcc.currencyCode,
        occurredAt,
        note: parsed.data.note ?? "Exchange in",
        exchangeGroupId: groupId,
      });
    });

    return c.json({ exchangeGroupId: groupId }, 201);
  });

  authed.get("/budgets", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const year = Number(c.req.query("year"));
    const month = Number(c.req.query("month"));
    if (!year || !month) return c.json({ error: "year_month_required" }, 400);
    const list = await d
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.year, year), eq(budgets.month, month)));

    const out = [];
    for (const b of list) {
      const spent = await sumExpenseForBudget(d, {
        userId,
        categoryId: b.categoryId,
        year: b.year,
        month: b.month,
        budgetCurrency: b.currencyCode,
      });
      out.push({
        ...b,
        spentMinor: spent,
        remainingMinor: b.limitMinor - spent,
      });
    }
    return c.json(out);
  });

  authed.post("/budgets", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const parsed = z
      .object({
        categoryId: z.string().uuid(),
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        limitMinor: z.number().int().positive(),
        currencyCode: z.string().min(3).max(16),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const [cat] = await d
      .select()
      .from(categories)
      .where(and(eq(categories.id, parsed.data.categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!cat || cat.kind !== "expense") {
      return c.json({ error: "expense_category_required" }, 400);
    }
    try {
      const [row] = await d
        .insert(budgets)
        .values({
          userId,
          categoryId: parsed.data.categoryId,
          year: parsed.data.year,
          month: parsed.data.month,
          limitMinor: parsed.data.limitMinor,
          currencyCode: parsed.data.currencyCode.toUpperCase(),
        })
        .returning();
      return c.json(row, 201);
    } catch {
      return c.json({ error: "duplicate_budget" }, 409);
    }
  });

  authed.patch("/budgets/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const parsed = z
      .object({ limitMinor: z.number().int().positive().optional() })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const [b] = await d
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.userId, userId)))
      .limit(1);
    if (!b) return c.json({ error: "not_found" }, 404);
    const [row] = await d
      .update(budgets)
      .set({
        limitMinor: parsed.data.limitMinor ?? b.limitMinor,
        updatedAt: new Date(),
      })
      .where(eq(budgets.id, id))
      .returning();
    return c.json(row);
  });

  authed.delete("/budgets/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const [b] = await d
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.userId, userId)))
      .limit(1);
    if (!b) return c.json({ error: "not_found" }, 404);
    await d.delete(budgets).where(eq(budgets.id, id));
    return c.body(null, 204);
  });

  authed.get("/recurring", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const list = await d
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.userId, userId))
      .orderBy(desc(recurringRules.createdAt));
    return c.json(list);
  });

  authed.post("/recurring", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const parsed = z
      .object({
        accountId: z.string().uuid(),
        categoryId: z.string().uuid().nullable().optional(),
        amountMinor: z.number().int().positive(),
        currencyCode: z.string().min(3).max(16),
        period: z.enum(["daily", "weekly", "monthly"]),
        nextAt: z.string().datetime({ offset: true }),
        note: z.string().max(2000).optional(),
        active: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const [acc] = await d
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, userId)))
      .limit(1);
    if (!acc) return c.json({ error: "account_not_found" }, 404);
    if (acc.currencyCode !== parsed.data.currencyCode.toUpperCase()) {
      return c.json({ error: "currency_mismatch_account" }, 400);
    }
    if (parsed.data.categoryId) {
      const [cat] = await d
        .select()
        .from(categories)
        .where(and(eq(categories.id, parsed.data.categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!cat || cat.kind !== "expense") {
        return c.json({ error: "expense_category_required" }, 400);
      }
    }
    const [row] = await d
      .insert(recurringRules)
      .values({
        userId,
        accountId: parsed.data.accountId,
        categoryId: parsed.data.categoryId ?? null,
        amountMinor: parsed.data.amountMinor,
        currencyCode: parsed.data.currencyCode.toUpperCase(),
        period: parsed.data.period,
        nextAt: new Date(parsed.data.nextAt),
        active: parsed.data.active ?? true,
        note: parsed.data.note ?? null,
      })
      .returning();
    return c.json(row, 201);
  });

  authed.patch("/recurring/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const parsed = z
      .object({
        amountMinor: z.number().int().positive().optional(),
        nextAt: z.string().datetime({ offset: true }).optional(),
        active: z.boolean().optional(),
        note: z.string().max(2000).nullable().optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const [r] = await d
      .select()
      .from(recurringRules)
      .where(and(eq(recurringRules.id, id), eq(recurringRules.userId, userId)))
      .limit(1);
    if (!r) return c.json({ error: "not_found" }, 404);
    const [row] = await d
      .update(recurringRules)
      .set({
        amountMinor: parsed.data.amountMinor ?? r.amountMinor,
        nextAt: parsed.data.nextAt ? new Date(parsed.data.nextAt) : r.nextAt,
        active: parsed.data.active ?? r.active,
        note: parsed.data.note === undefined ? r.note : parsed.data.note,
        updatedAt: new Date(),
      })
      .where(eq(recurringRules.id, id))
      .returning();
    return c.json(row);
  });

  authed.delete("/recurring/:id", async (c) => {
    const d = c.var.db;
    const userId = c.var.userId!;
    const id = c.req.param("id");
    const [r] = await d
      .select()
      .from(recurringRules)
      .where(and(eq(recurringRules.id, id), eq(recurringRules.userId, userId)))
      .limit(1);
    if (!r) return c.json({ error: "not_found" }, 404);
    await d.delete(recurringRules).where(eq(recurringRules.id, id));
    return c.body(null, 204);
  });

  app.get("/ext/summary", async (c) => {
    const e = c.var.env;
    const d = c.var.db;
    if (!e.API_BEARER_KEY || e.API_USER_TELEGRAM_ID == null) {
      return c.json({ error: "ext_not_configured" }, 503);
    }
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${e.API_BEARER_KEY}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const [user] = await d
      .select()
      .from(users)
      .where(eq(users.telegramId, e.API_USER_TELEGRAM_ID))
      .limit(1);
    if (!user) return c.json({ error: "user_not_found" }, 404);
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from_to_required" }, 400);
    const txs = await d
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          gte(transactions.occurredAt, new Date(from)),
          lte(transactions.occurredAt, new Date(to)),
        ),
      );
    let income = 0;
    let expense = 0;
    for (const t of txs) {
      const use =
        t.amountReportMinor != null && t.reportCurrency === user.reportCurrency
          ? t.amountReportMinor
          : t.currencyCode === user.reportCurrency
            ? t.amountMinor
            : null;
      if (use == null) continue;
      if (t.type === "income") income += use;
      else expense += use;
    }
    return c.json({
      userId: user.id,
      reportCurrency: user.reportCurrency,
      from,
      to,
      incomeMinor: income,
      expenseMinor: expense,
      netMinor: income - expense,
      transactionCount: txs.length,
    });
  });

  app.get("/ext/transactions", async (c) => {
    const e = c.var.env;
    const d = c.var.db;
    if (!e.API_BEARER_KEY || e.API_USER_TELEGRAM_ID == null) {
      return c.json({ error: "ext_not_configured" }, 503);
    }
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${e.API_BEARER_KEY}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const [user] = await d
      .select()
      .from(users)
      .where(eq(users.telegramId, e.API_USER_TELEGRAM_ID))
      .limit(1);
    if (!user) return c.json({ error: "user_not_found" }, 404);
    const from = c.req.query("from");
    const to = c.req.query("to");
    const filters = [eq(transactions.userId, user.id)];
    if (from) filters.push(gte(transactions.occurredAt, new Date(from)));
    if (to) filters.push(lte(transactions.occurredAt, new Date(to)));
    const list = await d
      .select()
      .from(transactions)
      .where(and(...filters))
      .orderBy(desc(transactions.occurredAt))
      .limit(200);
    return c.json(list);
  });

  app.post("/ext/agent/insights", async (c) => {
    const e = c.var.env;
    const d = c.var.db;
    if (!e.API_BEARER_KEY || e.API_USER_TELEGRAM_ID == null) {
      return c.json({ error: "ext_not_configured" }, 503);
    }
    if (!e.OPENAI_API_KEY) {
      return c.json({ error: "openai_not_configured" }, 503);
    }
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${e.API_BEARER_KEY}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const [user] = await d
      .select()
      .from(users)
      .where(eq(users.telegramId, e.API_USER_TELEGRAM_ID))
      .limit(1);
    if (!user) return c.json({ error: "user_not_found" }, 404);

    const body = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    const from =
      body.success && body.data.from
        ? body.data.from
        : new Date(Date.now() - 30 * 86400000).toISOString();
    const to = body.success && body.data.to ? body.data.to : new Date().toISOString();

    const txs = await d
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          gte(transactions.occurredAt, new Date(from)),
          lte(transactions.occurredAt, new Date(to)),
        ),
      )
      .orderBy(desc(transactions.occurredAt))
      .limit(80);

    const summary = {
      reportCurrency: user.reportCurrency,
      count: txs.length,
      sample: txs.slice(0, 20).map((t) => ({
        type: t.type,
        amountMinor: t.amountMinor,
        currency: t.currencyCode,
        at: t.occurredAt,
        note: t.note,
      })),
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${e.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a concise personal finance coach. Reply ONLY with valid JSON: {\"bullets\": string[], \"warnings\": string[]}. Russian language. No extra keys.",
          },
          {
            role: "user",
            content: JSON.stringify(summary),
          },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return c.json({ error: "openai_error", detail: t.slice(0, 500) }, 502);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "{}";
    let parsedJson: { bullets?: string[]; warnings?: string[] };
    try {
      parsedJson = JSON.parse(content) as { bullets?: string[]; warnings?: string[] };
    } catch {
      parsedJson = { bullets: [content], warnings: [] };
    }
    return c.json({ from, to, ...parsedJson });
  });

  app.route("/", authed);

  return app;
}
