import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { recurringRules, transactions } from "../db/schema";

type Period = "daily" | "weekly" | "monthly";

function addPeriod(d: Date, period: Period): Date {
  const x = new Date(d.getTime());
  if (period === "daily") {
    x.setUTCDate(x.getUTCDate() + 1);
    return x;
  }
  if (period === "weekly") {
    x.setUTCDate(x.getUTCDate() + 7);
    return x;
  }
  x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
}

export async function applyDueRecurring(db: Db, userId: string): Promise<number> {
  const now = new Date();
  let created = 0;

  for (;;) {
    const due = await db
      .select()
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.userId, userId),
          eq(recurringRules.active, true),
          lte(recurringRules.nextAt, now),
        ),
      )
      .limit(20);

    if (due.length === 0) break;

    for (const rule of due) {
      const period = rule.period as Period;
      await db.transaction(async (tx) => {
        let nextAt = rule.nextAt;
        let iterations = 0;
        const maxIterations = 400;
        while (nextAt <= now && iterations < maxIterations) {
          iterations++;
          await tx.insert(transactions).values({
            userId,
            accountId: rule.accountId,
            categoryId: rule.categoryId,
            type: "expense",
            amountMinor: rule.amountMinor,
            currencyCode: rule.currencyCode,
            occurredAt: nextAt,
            note: rule.note ?? "Recurring",
            sourceRecurringId: rule.id,
          });
          created++;
          nextAt = addPeriod(nextAt, period);
        }
        await tx
          .update(recurringRules)
          .set({ nextAt, updatedAt: new Date() })
          .where(eq(recurringRules.id, rule.id));
      });
    }
  }

  return created;
}
