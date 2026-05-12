import { getTelegramWebApp } from "./telegram";

/** Подставляет CSS-переменные из Telegram Mini App (если есть). */
export function applyTelegramThemeVars(): void {
  const tw = getTelegramWebApp();
  const t = tw?.themeParams;
  if (!t) return;
  const r = document.documentElement;
  const set = (name: string, val?: string) => {
    if (val) r.style.setProperty(name, val);
  };
  set("--app-bg", t.bg_color);
  set("--app-text", t.text_color);
  set("--app-hint", t.hint_color);
  set("--app-link", t.link_color);
  set("--app-accent", t.button_color);
  set("--app-on-accent", t.button_text_color);
  set("--app-surface", t.secondary_bg_color);
  set("--app-elevated", t.section_bg_color);
  if (t.bg_color && tw?.setHeaderColor) tw.setHeaderColor(t.bg_color);
  if (t.bg_color && tw?.setBackgroundColor) tw.setBackgroundColor(t.bg_color);
}
