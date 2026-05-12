const TOKEN_KEY = "finance_jwt";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Полный URL API (dev) или пусто; для Docker за тем же доменом задайте VITE_API_PREFIX=/api */
const apiBaseUrl = import.meta.env.VITE_API_URL ?? "";
const apiPrefix = import.meta.env.VITE_API_PREFIX ?? "";

export function isApiBaseConfigured(): boolean {
  return Boolean((apiBaseUrl && apiBaseUrl.length > 0) || (apiPrefix && apiPrefix.length > 0));
}

function resolveApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (apiPrefix) return `${apiPrefix}${p}`;
  return `${apiBaseUrl}${p}`;
}

function abortAfter(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 130_000;
  const { timeoutMs: _t, ...rest } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };
  if (rest.auth !== false) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path), {
      ...rest,
      headers,
      signal: abortAfter(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new Error(
        "Сервер не ответил вовремя. На бесплатном Render первый запрос после простоя может идти 1–2 минуты — закройте мини-апп и откройте снова или подождите.",
      );
    }
    throw e;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  const raw = await res.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `Ответ не JSON (проверьте VITE_API_URL). Начало ответа: ${raw.slice(0, 120)}`,
    );
  }
}
