import {
  pgTable,
  text,
  integer,
  bigint,
  uuid,
  timestamp,
  varchar,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const categoryKindEnum = pgEnum("category_kind", ["expense", "income"]);
export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
]);
export const recurringPeriodEnum = pgEnum("recurring_period", [
  "daily",
  "weekly",
  "monthly",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  ...timestamps,
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  firstName: varchar("first_name", { length: 255 }),
  username: varchar("username", { length: 255 }),
  reportCurrency: varchar("report_currency", { length: 16 }).notNull().default("RUB"),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...timestamps,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    currencyCode: varchar("currency_code", { length: 16 }).notNull(),
    isCrypto: boolean("is_crypto").notNull().default(false),
  },
  (t) => [index("idx_accounts_user").on(t.userId)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...timestamps,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    kind: categoryKindEnum("kind").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("idx_categories_user").on(t.userId)],
);

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...timestamps,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    amountMinor: integer("amount_minor").notNull(),
    currencyCode: varchar("currency_code", { length: 16 }).notNull(),
    period: recurringPeriodEnum("period").notNull(),
    nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    note: text("note"),
  },
  (t) => [index("idx_recurring_user_next").on(t.userId, t.nextAt)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...timestamps,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    type: transactionTypeEnum("type").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currencyCode: varchar("currency_code", { length: 16 }).notNull(),
    amountReportMinor: integer("amount_report_minor"),
    reportCurrency: varchar("report_currency", { length: 16 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    note: text("note"),
    exchangeGroupId: uuid("exchange_group_id"),
    sourceRecurringId: uuid("source_recurring_id").references(
      () => recurringRules.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    index("idx_tx_user_occurred").on(t.userId, t.occurredAt),
    index("idx_tx_account").on(t.accountId),
    index("idx_tx_exchange_group").on(t.exchangeGroupId),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...timestamps,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    limitMinor: integer("limit_minor").notNull(),
    currencyCode: varchar("currency_code", { length: 16 }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_budget_period_cat").on(
      t.userId,
      t.categoryId,
      t.year,
      t.month,
    ),
  ],
);
