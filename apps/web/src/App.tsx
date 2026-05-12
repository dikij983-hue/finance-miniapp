import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, clearToken, getToken, setToken, isApiBaseConfigured } from "./api";
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

function toIsoFromLocal(dtLocal: string) {
  return new Date(dtLocal).toISOString();
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
      } catch (e) {
        setErr(String(e));
        setReady(true);
        setBootHint(null);
      }
    })();
  }, [loadAll]);

  const logout = () => {
    clearToken();
    setMe(null);
    setAccounts([]);
    window.location.reload();
  };

  if (!ready) {
    return (
      <p style={{ padding: 16 }}>
        Загрузка…
        {bootHint && (
          <>
            <br />
            <span style={{ fontSize: 13, color: "#555" }}>{bootHint}</span>
          </>
        )}
      </p>
    );
  }
  if (err && !getToken()) return <p style={{ padding: 16, color: "crimson" }}>{err}</p>;

  return (
    <div style={{ padding: 12, fontFamily: "system-ui", maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18 }}>Финучёт</h1>
      {err && <p style={{ color: "orange" }}>{err}</p>}
      {me && (
        <p style={{ fontSize: 13 }}>
          Отчётная валюта: <strong>{me.reportCurrency}</strong>{" "}
          <button type="button" onClick={logout}>
            Выйти
          </button>
        </p>
      )}

      {getToken() && (
        <>
          <Section title="Синхронизация повторов">
            <button
              type="button"
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
              Применить просроченные повторы
            </button>
            {syncMsg && <p>{syncMsg}</p>}
          </Section>

          <Section title="Счета">
            <AccountForm
              onCreated={async () => {
                setAccounts(await api("/accounts"));
              }}
            />
            <ul>
              {accounts.map((a) => (
                <li key={a.id}>
                  {a.name} — {a.currencyCode} — баланс: {(a.balanceMinor / 100).toFixed(2)}{" "}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("Удалить счёт?")) return;
                      await api(`/accounts/${a.id}`, { method: "DELETE" });
                      setAccounts(await api("/accounts"));
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Категории">
            <CategoryForm
              onCreated={async () => {
                setCategories(await api("/categories"));
              }}
            />
            <ul>
              {categories.map((c) => (
                <li key={c.id}>
                  {c.name} ({c.kind})
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Доход / расход">
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
              }}
            />
          </Section>

          <Section title="Обмен между счетами">
            <ExchangeForm
              accounts={accounts}
              onDone={async () => {
                setTransactions(await api("/transactions"));
                setAccounts(await api("/accounts"));
              }}
            />
          </Section>

          <Section title="Бюджет (текущий месяц UTC)">
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
            <ul>
              {budgets.map((b) => (
                <li key={b.id}>
                  лимит {(b.limitMinor / 100).toFixed(2)} {b.currencyCode} / потрачено{" "}
                  {(b.spentMinor / 100).toFixed(2)} / осталось {(b.remainingMinor / 100).toFixed(2)}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Повторяющиеся расходы">
            <RecurringForm
              accounts={accounts}
              categories={categories}
              onDone={async () => {
                setRecurring(await api("/recurring"));
              }}
            />
            <ul>
              {recurring.map((r) => (
                <li key={r.id}>
                  {r.amountMinor / 100} {r.currencyCode} каждые {r.period}, след.{" "}
                  {new Date(r.nextAt).toLocaleString()}{" "}
                  <button
                    type="button"
                    onClick={async () => {
                      await api(`/recurring/${r.id}`, { method: "DELETE" });
                      setRecurring(await api("/recurring"));
                    }}
                  >
                    удалить
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Последние операции">
            <ul style={{ fontSize: 13 }}>
              {transactions.slice(0, 40).map((t) => (
                <li key={t.id}>
                  {t.type} {t.amountMinor / 100} {t.currencyCode}{" "}
                  {t.note ?? ""}{" "}
                  {new Date(t.occurredAt).toLocaleString()}{" "}
                  {!t.exchangeGroupId && (
                    <button
                      type="button"
                      onClick={async () => {
                        await api(`/transactions/${t.id}`, { method: "DELETE" });
                        setTransactions(await api("/transactions"));
                        setAccounts(await api("/accounts"));
                      }}
                    >
                      удалить
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {import.meta.env.DEV && !getTelegramWebApp()?.initData && (
        <Section title="Dev: вход без Telegram">
          <p style={{ fontSize: 12 }}>
            Вставьте initData из Telegram (или откройте внутри мини-аппа). JWT сохраняется в
            localStorage.
          </p>
          <textarea id="dev-init" rows={3} style={{ width: "100%" }} placeholder="initData…" />
          <button
            type="button"
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
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset style={{ marginBottom: 16, border: "1px solid #ccc" }}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function AccountForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("RUB");
  const [isCrypto, setIsCrypto] = useState(false);
  return (
    <form
      style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
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
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" required />
      <input value={currency} onChange={(e) => setCurrency(e.target.value)} size={6} />
      <label>
        <input type="checkbox" checked={isCrypto} onChange={(e) => setIsCrypto(e.target.checked)} />{" "}
        крипто
      </label>
      <button type="submit">+ счёт</button>
    </form>
  );
}

function CategoryForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  return (
    <form
      style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      onSubmit={async (e) => {
        e.preventDefault();
        await api("/categories", { method: "POST", body: JSON.stringify({ name, kind }) });
        setName("");
        await onCreated();
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Категория" required />
      <select value={kind} onChange={(e) => setKind(e.target.value as "expense" | "income")}>
        <option value="expense">расход</option>
        <option value="income">доход</option>
      </select>
      <button type="submit">+ категория</button>
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
  const [amountMajor, setAmountMajor] = useState(""); // user types rubles
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
      <div style={{ display: "grid", gap: 6 }}>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          <option value="">Счёт</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currencyCode})
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as "expense" | "income")}>
          <option value="expense">расход</option>
          <option value="income">доход</option>
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Без категории</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={amountMajor}
          onChange={(e) => setAmountMajor(e.target.value)}
          placeholder={`Сумма в ${acc?.currencyCode ?? "валюте"} (например 10.50)`}
          required
        />
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
        />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="комментарий" />
        <input
          value={reportMajor}
          onChange={(e) => setReportMajor(e.target.value)}
          placeholder="Эквивалент для бюджета в RUB (опционально)"
        />
        <button type="submit">Записать</button>
      </div>
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
      <div style={{ display: "grid", gap: 6 }}>
        <select value={fromId} onChange={(e) => setFromId(e.target.value)} required>
          <option value="">Списать с</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currencyCode})
            </option>
          ))}
        </select>
        <input
          value={outMajor}
          onChange={(e) => setOutMajor(e.target.value)}
          placeholder={`Сумма списания (${fromAcc?.currencyCode ?? ""})`}
          required
        />
        <select value={toId} onChange={(e) => setToId(e.target.value)} required>
          <option value="">Зачислить на</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currencyCode})
            </option>
          ))}
        </select>
        <input
          value={inMajor}
          onChange={(e) => setInMajor(e.target.value)}
          placeholder={`Сумма зачисления (${toAcc?.currencyCode ?? ""})`}
          required
        />
        <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        <button type="submit">Обменять</button>
      </div>
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
      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
        <option value="">Категория расхода</option>
        {exp.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input value={limitMajor} onChange={(e) => setLimitMajor(e.target.value)} placeholder="Лимит" required />
      <input value={currency} onChange={(e) => setCurrency(e.target.value)} size={6} />
      <button type="submit">+ бюджет на месяц</button>
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
      <div style={{ display: "grid", gap: 6 }}>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          <option value="">Счёт</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currencyCode})
            </option>
          ))}
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Без категории</option>
          {exp.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={amountMajor}
          onChange={(e) => setAmountMajor(e.target.value)}
          placeholder="Сумма"
          required
        />
        <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          <option value="daily">день</option>
          <option value="weekly">неделя</option>
          <option value="monthly">месяц</option>
        </select>
        <input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
        <button type="submit">+ повтор</button>
      </div>
    </form>
  );
}
