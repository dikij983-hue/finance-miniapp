import { useCallback, useEffect, useState } from "react";
import { api, clearToken, getToken, setToken, isApiBaseConfigured } from "./api";
import { formatMoney, formatShortDate } from "./formatMoney";
import { applyTelegramThemeVars } from "./theme";
import { getTelegramWebApp } from "./telegram";

type Account = {
  id: string;
  name: string;
  currencyCode: string;
  isCrypto: boolean;
  balanceMinor: number;
};

type Category = {
  id: string;
  name: string;
  kind: "expense" | "income";
  archivedAt: string | null;
};

type Transaction = {
  id: string;
  accountId: string;
  categoryId: string | null;
  type: "income" | "expense";
  amountMinor: number;
  currencyCode: string;
  occurredAt: string;
  note: string | null;
  exchangeGroupId: string | null;
};

type BudgetRow = {
  id: string;
  categoryId: string;
  year: number;
  month: number;
  limitMinor: number;
  currencyCode: string;
  spentMinor: number;
  remainingMinor: number;
};

type RecurringRow = {
  id: string;
  accountId: string;
  categoryId: string | null;
  amountMinor: number;
  currencyCode: string;
  period: "daily" | "weekly" | "monthly";
  nextAt: string;
  active: boolean;
  note: string | null;
};

type Tab = "home" | "action" | "history" | "more";
type ActionSub = "tx" | "exchange";

function toIsoFromLocal(dtLocal: string) {
  return new Date(dtLocal).toISOString();
}

function categoryName(categories: Category[], id: string | null) {
  if (!id) return "Без категории";
  return categories.find((c) => c.id === id)?.name ?? "Категория";
}

function accountName(accounts: Account[], id: string) {
  return accounts.find((a) => a.id === id)?.name ?? "Счёт";
}

function categoryInitial(text: string): string {
  const t = text.trim();
  if (!t) return "±";
  const ch = [...t][0];
  return ch ? ch.toLocaleUpperCase("ru-RU") : "?";
}

function localDateKeyFromIso(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayLocalKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayLocalKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateSectionLabel(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === todayKey) return "Сегодня";
  if (key === yesterdayKey) return "Вчера";
  const [y, m, day] = key.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}

function groupTransactionsByLocalDate(transactions: Transaction[]) {
  const tk = todayLocalKey();
  const yk = yesterdayLocalKey();
  const groups: { key: string; label: string; items: Transaction[] }[] = [];
  let lastKey = "";
  for (const t of transactions) {
    const k = localDateKeyFromIso(t.occurredAt);
    if (k !== lastKey) {
      groups.push({ key: k, label: dateSectionLabel(k, tk, yk), items: [] });
      lastKey = k;
    }
    groups[groups.length - 1]!.items.push(t);
  }
  return groups;
}

function TxRow({
  t,
  categories,
  accounts,
  showDelete,
  onDelete,
}: {
  t: Transaction;
  categories: Category[];
  accounts: Account[];
  showDelete?: boolean;
  onDelete?: () => void | Promise<void>;
}) {
  const titleBase = categoryName(categories, t.categoryId);
  const title = `${titleBase}${t.note ? ` · ${t.note}` : ""}`;
  const initial = categoryInitial(titleBase);
  const avatarClass =
    t.type === "income"
      ? "tx-row-avatar tx-row-avatar--income"
      : "tx-row-avatar tx-row-avatar--expense";
  const amtClass =
    t.type === "expense" ? "tx-amount tx-amount--expense" : "tx-amount tx-amount--income";

  return (
    <li className="tx-row">
      <div className={avatarClass} aria-hidden>
        {initial}
      </div>
      <div className="tx-row-body">
        <div className="tx-row-main">
          <div className="tx-row-title">{title}</div>
          <div className="tx-row-sub">
            {accountName(accounts, t.accountId)} · {formatShortDate(t.occurredAt)}
          </div>
        </div>
        <div className="tx-row-actions">
          <span className={amtClass}>
            {t.type === "expense" ? "−" : "+"}
            {formatMoney(t.amountMinor, t.currencyCode)}
          </span>
          {showDelete && !t.exchangeGroupId && onDelete && (
            <button type="button" className="btn btn-ghost btn-ghost-danger" onClick={() => void onDelete()}>
              Удалить
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function App() {
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<{ reportCurrency: string } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [recurring, setRecurring] = useState<RecurringRow[]>([]);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [bootHint, setBootHint] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [actionSub, setActionSub] = useState<ActionSub>("tx");

  const loadAll = useCallback(async () => {
    if (!getToken()) return;
    const [a, c, t, meRow, rec] = await Promise.all([
      api<Account[]>("/accounts"),
      api<Category[]>("/categories"),
      api<Transaction[]>("/transactions"),
      api<{ reportCurrency: string }>("/me"),
      api<RecurringRow[]>("/recurring"),
    ]);
    setAccounts(a);
    setCategories(c.filter((x) => !x.archivedAt));
    setTransactions(t);
    setMe(meRow);
    setRecurring(rec);
    const now = new Date();
    const b = await api<BudgetRow[]>(
      `/budgets?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
    );
    setBudgets(b);
  }, []);

  useEffect(() => {
    const tw = getTelegramWebApp();
    tw?.ready();
    tw?.expand?.();
    tw?.disableVerticalSwipes?.();
    applyTelegramThemeVars();

    (async () => {
      try {
        if (!import.meta.env.DEV && !isApiBaseConfigured()) {
          setErr(
            "В сборке не задан VITE_API_URL. Render → finance-miniapp-web → Environment: добавьте VITE_API_URL = https://ваш-api.onrender.com и пересоберите.",
          );
          setReady(true);
          return;
        }
        const initData = tw?.initData ?? "";
        if (!initData && import.meta.env.DEV) {
          if (getToken()) {
            setReady(true);
            await loadAll();
          }
          setReady(true);
          applyTelegramThemeVars();
          return;
        }
        if (!initData) {
          setErr("Откройте приложение из Telegram");
          setReady(true);
          return;
        }
        setBootHint(
          "Подключение к серверу… (на Render free первый запрос может занять до 1–2 мин)",
        );
        const { token } = await api<{ token: string }>("/auth/telegram", {
          method: "POST",
          body: JSON.stringify({ initData }),
          auth: false,
        });
        setToken(token);
        setBootHint("Синхронизация повторов…");
        await api("/sync/recurring", { method: "POST" });
        setBootHint("Загрузка данных…");
        setReady(true);
        await loadAll();
        setBootHint(null);
        applyTelegramThemeVars();
      } catch (e) {
        setErr(String(e));
        setReady(true);
        setBootHint(null);
      }
    })();
  }, [loadAll]);

  useEffect(() => {
    if (ready) applyTelegramThemeVars();
  }, [ready]);

  const logout = () => {
    clearToken();
    setMe(null);
    setAccounts([]);
    window.location.reload();
  };

  if (!ready) {
    return (
      <div className="state-block">
        <div className="loader-title">Загрузка…</div>
        {bootHint && <p>{bootHint}</p>}
      </div>
    );
  }
  if (err && !getToken()) {
    return (
      <div className="state-block state-block--error">
        <div className="loader-title">Не удалось войти</div>
        <p>{err}</p>
      </div>
    );
  }

  const sortedTx = [...transactions].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Финучёт</h1>
        <div className="app-header-meta">
          <span>{me ? `Отчёт: ${me.reportCurrency}` : " "}</span>
          <div className="row-actions">
            {getToken() && (
              <button type="button" className="btn btn-ghost" onClick={logout}>
                Выйти
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {err && (
          <div className="card card--muted" style={{ marginBottom: 12 }}>
            <p style={{ margin: 0, color: "var(--app-danger)", fontSize: "0.875rem" }}>{err}</p>
          </div>
        )}

        {getToken() && (
          <>
            {tab === "home" && (
              <>
                <p className="screen-title">Счета</p>
                {accounts.length === 0 ? (
                  <div className="card empty-card">
                    <p>Счетов пока нет — добавьте первый, чтобы вести учёт.</p>
                    <button type="button" className="btn btn-primary" onClick={() => setTab("more")}>
                      Добавить счёт
                    </button>
                  </div>
                ) : (
                  <div className="accounts-scroll">
                    {accounts.map((a) => (
                      <div key={a.id} className="account-card">
                        <div className="account-card-name">{a.name}</div>
                        <div className="account-card-balance">
                          {formatMoney(a.balanceMinor, a.currencyCode)}
                        </div>
                        <div className="account-card-meta">
                          {a.currencyCode}
                          {a.isCrypto ? " · крипто" : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="screen-title" style={{ marginTop: 8 }}>
                  Последние операции
                </p>
                <div className="card">
                  {sortedTx.length === 0 ? (
                    <div className="empty-card">
                      <p>Операций ещё нет — запишите доход или расход.</p>
                      <button type="button" className="btn btn-primary" onClick={() => setTab("action")}>
                        Новая запись
                      </button>
                    </div>
                  ) : (
                    <ul className="tx-list">
                      {sortedTx.slice(0, 12).map((t) => (
                        <TxRow key={t.id} t={t} categories={categories} accounts={accounts} />
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {tab === "action" && (
              <>
                <div className="segmented">
                  <button
                    type="button"
                    className={actionSub === "tx" ? "active" : ""}
                    onClick={() => setActionSub("tx")}
                  >
                    Операция
                  </button>
                  <button
                    type="button"
                    className={actionSub === "exchange" ? "active" : ""}
                    onClick={() => setActionSub("exchange")}
                  >
                    Обмен
                  </button>
                </div>
                {actionSub === "tx" ? (
                  <div className="card">
                    <h2 className="card-title">Доход или расход</h2>
                    <TransactionForm
                      accounts={accounts}
                      categories={categories}
                      onDone={async () => {
                        setTransactions(await api("/transactions"));
                        setAccounts(await api("/accounts"));
                        const now = new Date();
                        setBudgets(
                          await api(
                            `/budgets?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
                          ),
                        );
                        setTab("history");
                      }}
                    />
                  </div>
                ) : (
                  <div className="card">
                    <h2 className="card-title">Между счетами</h2>
                    <ExchangeForm
                      accounts={accounts}
                      onDone={async () => {
                        setTransactions(await api("/transactions"));
                        setAccounts(await api("/accounts"));
                        setTab("history");
                      }}
                    />
                  </div>
                )}
              </>
            )}

            {tab === "history" && (
              <>
                <p className="screen-title">Все операции</p>
                <div className="card">
                  {sortedTx.length === 0 ? (
                    <div className="empty-card">
                      <p>Здесь появятся все операции.</p>
                      <button type="button" className="btn btn-primary" onClick={() => setTab("action")}>
                        Добавить операцию
                      </button>
                    </div>
                  ) : (
                    <>
                      {groupTransactionsByLocalDate(sortedTx.slice(0, 80)).map((g) => (
                        <div key={g.key} className="tx-date-group">
                          <div className="tx-date-heading">{g.label}</div>
                          <ul className="tx-list">
                            {g.items.map((t) => (
                              <TxRow
                                key={t.id}
                                t={t}
                                categories={categories}
                                accounts={accounts}
                                showDelete
                                onDelete={async () => {
                                  if (!confirm("Удалить операцию?")) return;
                                  await api(`/transactions/${t.id}`, { method: "DELETE" });
                                  setTransactions(await api("/transactions"));
                                  setAccounts(await api("/accounts"));
                                }}
                              />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}

            {tab === "more" && (
              <>
                <div className="card">
                  <h2 className="card-title">Повторы</h2>
                  <p style={{ margin: "0 0 12px", fontSize: "0.875rem", color: "var(--app-hint)" }}>
                    Применить просроченные шаблоны к счетам.
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: "100%" }}
                    onClick={async () => {
                      try {
                        const r = await api<{ applied: number }>("/sync/recurring", {
                          method: "POST",
                        });
                        setSyncMsg(`Создано операций: ${r.applied}`);
                        await loadAll();
                      } catch (e) {
                        setSyncMsg(String(e));
                      }
                    }}
                  >
                    Синхронизировать повторы
                  </button>
                  {syncMsg && (
                    <p style={{ margin: "10px 0 0", fontSize: "0.875rem" }}>{syncMsg}</p>
                  )}
                </div>

                <div className="card">
                  <h2 className="card-title">Счета</h2>
                  <AccountForm
                    onCreated={async () => {
                      setAccounts(await api("/accounts"));
                    }}
                  />
                  <ul className="tx-list" style={{ marginTop: 12 }}>
                    {accounts.map((a) => (
                      <li key={a.id} className="tx-row">
                        <div className="tx-row-main">
                          <div className="tx-row-title">{a.name}</div>
                          <div className="tx-row-sub">
                            {formatMoney(a.balanceMinor, a.currencyCode)}
                            {a.isCrypto ? " · крипто" : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-ghost-danger"
                          onClick={async () => {
                            if (!confirm("Удалить счёт?")) return;
                            await api(`/accounts/${a.id}`, { method: "DELETE" });
                            setAccounts(await api("/accounts"));
                          }}
                        >
                          Удалить
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="card">
                  <h2 className="card-title">Категории</h2>
                  <CategoryForm
                    onCreated={async () => {
                      setCategories(await api("/categories"));
                    }}
                  />
                  <div className="chip-list" style={{ marginTop: 12 }}>
                    {categories.map((c) => (
                      <span
                        key={c.id}
                        className={`chip ${c.kind === "expense" ? "chip--expense" : "chip--income"}`}
                      >
                        {c.name} · {c.kind === "expense" ? "расход" : "доход"}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <h2 className="card-title">Бюджет (текущий месяц UTC)</h2>
                  <BudgetForm
                    categories={categories}
                    onDone={async () => {
                      const now = new Date();
                      setBudgets(
                        await api(
                          `/budgets?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
                        ),
                      );
                    }}
                  />
                  {budgets.map((b) => (
                    <div key={b.id} className="budget-row">
                      <strong>{categoryName(categories, b.categoryId)}</strong>
                      <br />
                      лимит {formatMoney(b.limitMinor, b.currencyCode)} · потрачено{" "}
                      {formatMoney(b.spentMinor, b.currencyCode)} · осталось{" "}
                      {formatMoney(b.remainingMinor, b.currencyCode)}
                    </div>
                  ))}
                </div>

                <div className="card">
                  <h2 className="card-title">Повторяющиеся расходы</h2>
                  <RecurringForm
                    accounts={accounts}
                    categories={categories}
                    onDone={async () => {
                      setRecurring(await api("/recurring"));
                    }}
                  />
                  <ul className="tx-list" style={{ marginTop: 12 }}>
                    {recurring.map((r) => (
                      <li key={r.id} className="tx-row">
                        <div className="tx-row-main">
                          <div className="tx-row-title">
                            {formatMoney(r.amountMinor, r.currencyCode)} · {r.period}
                          </div>
                          <div className="tx-row-sub">
                            {accountName(accounts, r.accountId)} · след.{" "}
                            {formatShortDate(r.nextAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-ghost-danger"
                          onClick={async () => {
                            await api(`/recurring/${r.id}`, { method: "DELETE" });
                            setRecurring(await api("/recurring"));
                          }}
                        >
                          Удалить
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}

        {import.meta.env.DEV && !getTelegramWebApp()?.initData && (
          <div className="card card--muted">
            <h2 className="card-title">Dev: вход без Telegram</h2>
            <p style={{ margin: "0 0 10px", fontSize: "0.8125rem", color: "var(--app-hint)" }}>
              Вставьте initData. JWT в localStorage.
            </p>
            <textarea
              id="dev-init"
              rows={3}
              className="input"
              style={{ resize: "vertical", marginBottom: 10 }}
              placeholder="initData…"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const el = document.getElementById("dev-init") as HTMLTextAreaElement;
                const initData = el.value.trim();
                const { token } = await api<{ token: string }>("/auth/telegram", {
                  method: "POST",
                  body: JSON.stringify({ initData }),
                  auth: false,
                });
                setToken(token);
                window.location.reload();
              }}
            >
              Войти по initData
            </button>
          </div>
        )}
      </main>

      {getToken() && (
        <nav className="bottom-nav" aria-label="Основные разделы">
          <button type="button" className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
            <span className="nav-icon" aria-hidden>
              🏠
            </span>
            Обзор
          </button>
          <button type="button" className={tab === "action" ? "active" : ""} onClick={() => setTab("action")}>
            <span className="nav-icon" aria-hidden>
              ➕
            </span>
            Запись
          </button>
          <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            <span className="nav-icon" aria-hidden>
              📋
            </span>
            История
          </button>
          <button type="button" className={tab === "more" ? "active" : ""} onClick={() => setTab("more")}>
            <span className="nav-icon" aria-hidden>
              ⚙
            </span>
            Ещё
          </button>
        </nav>
      )}
    </div>
  );
}

function AccountForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("RUB");
  const [isCrypto, setIsCrypto] = useState(false);
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        await api("/accounts", {
          method: "POST",
          body: JSON.stringify({ name, currencyCode: currency, isCrypto }),
        });
        setName("");
        await onCreated();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="f-acc-name">
          Название
        </label>
        <input
          id="f-acc-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например, Основной"
          required
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-acc-cur">
          Валюта
        </label>
        <input
          id="f-acc-cur"
          className="input"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          placeholder="RUB, USD, EUR…"
        />
      </div>
      <label className="label-row">
        <input type="checkbox" checked={isCrypto} onChange={(e) => setIsCrypto(e.target.checked)} />
        Криптовалютный счёт
      </label>
      <button type="submit" className="btn btn-primary">
        Добавить счёт
      </button>
    </form>
  );
}

function CategoryForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        await api("/categories", { method: "POST", body: JSON.stringify({ name, kind }) });
        setName("");
        await onCreated();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="f-cat-name">
          Название
        </label>
        <input
          id="f-cat-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Продукты, Зарплата…"
          required
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-cat-kind">
          Тип
        </label>
        <select
          id="f-cat-kind"
          className="select"
          value={kind}
          onChange={(e) => setKind(e.target.value as "expense" | "income")}
        >
          <option value="expense">Расход</option>
          <option value="income">Доход</option>
        </select>
      </div>
      <button type="submit" className="btn btn-primary">
        Добавить категорию
      </button>
    </form>
  );
}

function TransactionForm({
  accounts,
  categories,
  onDone,
}: {
  accounts: Account[];
  categories: Category[];
  onDone: () => Promise<void>;
}) {
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amountMajor, setAmountMajor] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [note, setNote] = useState("");
  const [reportMajor, setReportMajor] = useState("");

  const acc = accounts.find((a) => a.id === accountId);
  const cats = categories.filter((c) => c.kind === type);

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!acc) return;
        const amountMinor = Math.round(parseFloat(amountMajor.replace(",", ".")) * 100);
        const body: Record<string, unknown> = {
          accountId,
          categoryId: categoryId || null,
          type,
          amountMinor,
          currencyCode: acc.currencyCode,
          occurredAt: toIsoFromLocal(occurredAt),
          note: note || undefined,
        };
        if (reportMajor) {
          body.amountReportMinor = Math.round(parseFloat(reportMajor.replace(",", ".")) * 100);
          body.reportCurrency = "RUB";
        }
        await api("/transactions", { method: "POST", body: JSON.stringify(body) });
        setAmountMajor("");
        setReportMajor("");
        await onDone();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="f-tx-acc">
          Счёт
        </label>
        <select
          id="f-tx-acc"
          className="select"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
        >
          <option value="">Выберите счёт</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currencyCode})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field-label">Тип операции</span>
        <div className="segmented" style={{ marginBottom: 0 }}>
          <button type="button" className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>
            Расход
          </button>
          <button type="button" className={type === "income" ? "active" : ""} onClick={() => setType("income")}>
            Доход
          </button>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-tx-cat">
          Категория
        </label>
        <select id="f-tx-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Без категории</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-tx-amt">
          Сумма ({acc?.currencyCode ?? "валюта счёта"})
        </label>
        <input
          id="f-tx-amt"
          className="input"
          inputMode="decimal"
          value={amountMajor}
          onChange={(e) => setAmountMajor(e.target.value)}
          placeholder="0,00"
          required
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-tx-when">
          Когда
        </label>
        <input
          id="f-tx-when"
          className="input"
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-tx-note">
          Комментарий
        </label>
        <input
          id="f-tx-note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Необязательно"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-tx-rub">
          В бюджете (RUB)
        </label>
        <input
          id="f-tx-rub"
          className="input"
          value={reportMajor}
          onChange={(e) => setReportMajor(e.target.value)}
          placeholder="Эквивалент для лимита — необязательно"
        />
      </div>
      <button type="submit" className="btn btn-primary">
        Сохранить операцию
      </button>
    </form>
  );
}

function ExchangeForm({
  accounts,
  onDone,
}: {
  accounts: Account[];
  onDone: () => Promise<void>;
}) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [outMajor, setOutMajor] = useState("");
  const [inMajor, setInMajor] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  const fromAcc = accounts.find((a) => a.id === fromId);
  const toAcc = accounts.find((a) => a.id === toId);

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!fromAcc || !toAcc) return;
        await api("/exchanges", {
          method: "POST",
          body: JSON.stringify({
            fromAccountId: fromId,
            toAccountId: toId,
            amountOutMinor: Math.round(parseFloat(outMajor.replace(",", ".")) * 100),
            amountInMinor: Math.round(parseFloat(inMajor.replace(",", ".")) * 100),
            occurredAt: toIsoFromLocal(occurredAt),
          }),
        });
        setOutMajor("");
        setInMajor("");
        await onDone();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="f-ex-from">
          Списать со счёта
        </label>
        <select id="f-ex-from" className="select" value={fromId} onChange={(e) => setFromId(e.target.value)} required>
          <option value="">Выберите</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currencyCode})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-ex-out">
          Сумма списания ({fromAcc?.currencyCode ?? "—"})
        </label>
        <input
          id="f-ex-out"
          className="input"
          inputMode="decimal"
          value={outMajor}
          onChange={(e) => setOutMajor(e.target.value)}
          placeholder="0,00"
          required
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-ex-to">
          Зачислить на счёт
        </label>
        <select id="f-ex-to" className="select" value={toId} onChange={(e) => setToId(e.target.value)} required>
          <option value="">Выберите</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currencyCode})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-ex-in">
          Сумма зачисления ({toAcc?.currencyCode ?? "—"})
        </label>
        <input
          id="f-ex-in"
          className="input"
          inputMode="decimal"
          value={inMajor}
          onChange={(e) => setInMajor(e.target.value)}
          placeholder="0,00"
          required
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-ex-when">
          Когда
        </label>
        <input
          id="f-ex-when"
          className="input"
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary">
        Выполнить обмен
      </button>
    </form>
  );
}

function BudgetForm({
  categories,
  onDone,
}: {
  categories: Category[];
  onDone: () => Promise<void>;
}) {
  const exp = categories.filter((c) => c.kind === "expense");
  const [categoryId, setCategoryId] = useState("");
  const [limitMajor, setLimitMajor] = useState("");
  const [currency, setCurrency] = useState("RUB");

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const now = new Date();
        await api("/budgets", {
          method: "POST",
          body: JSON.stringify({
            categoryId,
            year: now.getUTCFullYear(),
            month: now.getUTCMonth() + 1,
            limitMinor: Math.round(parseFloat(limitMajor.replace(",", ".")) * 100),
            currencyCode: currency,
          }),
        });
        setLimitMajor("");
        await onDone();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="f-bud-cat">
          Категория расхода
        </label>
        <select id="f-bud-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
          <option value="">Выберите</option>
          {exp.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-bud-lim">
          Лимит на месяц
        </label>
        <input
          id="f-bud-lim"
          className="input"
          inputMode="decimal"
          value={limitMajor}
          onChange={(e) => setLimitMajor(e.target.value)}
          placeholder="0,00"
          required
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-bud-cur">
          Валюта лимита
        </label>
        <input
          id="f-bud-cur"
          className="input"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          placeholder="RUB"
        />
      </div>
      <button type="submit" className="btn btn-primary">
        Сохранить бюджет
      </button>
    </form>
  );
}

function RecurringForm({
  accounts,
  categories,
  onDone,
}: {
  accounts: Account[];
  categories: Category[];
  onDone: () => Promise<void>;
}) {
  const exp = categories.filter((c) => c.kind === "expense");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [nextAt, setNextAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  const acc = accounts.find((a) => a.id === accountId);

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!acc) return;
        await api("/recurring", {
          method: "POST",
          body: JSON.stringify({
            accountId,
            categoryId: categoryId || null,
            amountMinor: Math.round(parseFloat(amountMajor.replace(",", ".")) * 100),
            currencyCode: acc.currencyCode,
            period,
            nextAt: toIsoFromLocal(nextAt),
          }),
        });
        setAmountMajor("");
        await onDone();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="f-rec-acc">
          Счёт
        </label>
        <select id="f-rec-acc" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          <option value="">Выберите</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currencyCode})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-rec-cat">
          Категория
        </label>
        <select id="f-rec-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Без категории</option>
          {exp.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-rec-amt">
          Сумма
        </label>
        <input
          id="f-rec-amt"
          className="input"
          inputMode="decimal"
          value={amountMajor}
          onChange={(e) => setAmountMajor(e.target.value)}
          placeholder="0,00"
          required
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-rec-per">
          Период
        </label>
        <select id="f-rec-per" className="select" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          <option value="daily">Каждый день</option>
          <option value="weekly">Каждую неделю</option>
          <option value="monthly">Каждый месяц</option>
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="f-rec-next">
          Следующее списание
        </label>
        <input id="f-rec-next" className="input" type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-primary">
        Добавить повтор
      </button>
    </form>
  );
}
