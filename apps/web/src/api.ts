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

function resolveApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (apiPrefix) return `${apiPrefix}${p}`;
  return `${apiBaseUrl}${p}`;
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (opts.auth !== false) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(resolveApiUrl(path), {
    ...opts,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
