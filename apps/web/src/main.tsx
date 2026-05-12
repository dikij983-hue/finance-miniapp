import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/** В консоли страницы (не Cursor): `__financeDev` — есть ли Telegram SDK и initData. */
if (import.meta.env.DEV) {
  (window as unknown as { __financeDev?: object }).__financeDev = {
    get hasTelegramGlobal() {
      return typeof (window as unknown as { Telegram?: unknown }).Telegram !== "undefined";
    },
    get initData() {
      return (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp
        ?.initData ?? "";
    },
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
