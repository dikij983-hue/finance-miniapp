/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Например /api — запросы на тот же хост (Nginx проксирует на бэкенд) */
  readonly VITE_API_PREFIX?: string;
}

export {};
