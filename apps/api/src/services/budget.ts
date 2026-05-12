import { and, eq, gte, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { transactions } from "../db/schema";

export async function sumExpenseForBudget(
  db: Db,
  params: {
    userId: string;
    categoryId: string;
    year: number;
    month: number;
    budgetCurrency: string;
  },
): Promise<number> {
  const { userId, categoryId, year, month, budgetCurrency } = params;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const rows = await db
    .select({
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      amountReportMinor: transactions.amountReportMinor,
      reportCurrency: transactions.reportCurrency,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.categoryId, categoryId),
        eq(transactions.type, "expense"),
        gte(transactions.occurredAt, start),
        lte(transactions.occurredAt, end),
        isNull(transactions.exchangeGroupId),
      ),
    );

  let total = 0;
  for (const t of rows) {
    if (
      t.amountReportMinor != null &&
      t.reportCurrency === budgetCurrency
    ) {
      total += t.amountReportMinor;
    } else if (
      t.amountReportMinor == null &&
      t.currencyCode === budgetCurrency
    ) {
      total += t.amountMinor;
    }
  }
  return total;
}

export async function accountBalances(
  db: Db,
  userId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId));
  const m = new Map<string, number>();
  for (const t of rows) {
    const delta = t.type === "income" ? t.amountMinor : -t.amountMinor;
    m.set(t.accountId, (m.get(t.accountId) ?? 0) + delta);
  }
  return m;
}
