import { getTelegramWebApp } from "./telegram";

function parseHexColor(s: string): { r: number; g: number; b: number } | null {
  let h = s.trim();
  if (!h.startsWith("#")) return null;
  h = h.slice(1);
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLuminance(rgb: { r: number; g: number; b: number }): number {
  const lin = (x: number) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(rgb.r);
  const G = lin(rgb.g);
  const B = lin(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Подставляет CSS-переменные из Telegram Mini App (если есть). */
export function applyTelegramThemeVars(): void {
  const tw = getTelegramWebApp();
  const t = tw?.themeParams;
  const root = document.documentElement;

  const clearHeaderOverrides = () => {
    root.style.removeProperty("--app-header-bg");
    root.style.removeProperty("--app-header-text");
    root.classList.remove("tg-dark", "tg-light");
    root.style.removeProperty("color-scheme");
  };

  if (!t) {
    clearHeaderOverrides();
    return;
  }

  const set = (name: string, val?: string) => {
    if (val) root.style.setProperty(name, val);
  };

  set("--app-bg", t.bg_color);
  set("--app-text", t.text_color);
  set("--app-hint", t.hint_color);
  set("--app-link", t.link_color);
  set("--app-accent", t.button_color);
  set("--app-on-accent", t.button_text_color);
  set("--app-surface", t.secondary_bg_color);
  set("--app-elevated", t.section_bg_color);

  const bgHex = t.bg_color?.trim();
  const rgb = bgHex ? parseHexColor(bgHex) : null;

  if (!bgHex || !rgb) {
    clearHeaderOverrides();
  } else {
    const lum = relLuminance(rgb);
    const dark = lum < 0.42;

    root.classList.toggle("tg-dark", dark);
    root.classList.toggle("tg-light", !dark);
    root.style.colorScheme = dark ? "dark" : "light";

    const sec = t.secondary_bg_color?.trim();
    const text = t.text_color ?? (dark ? "#f8fafc" : "#0f172a");

    if (dark) {
      const headerBg = sec && parseHexColor(sec) ? sec : `color-mix(in srgb, ${bgHex} 88%, #000 12%)`;
      set("--app-header-bg", headerBg);
      set("--app-header-text", t.subtitle_text_color ?? "#f1f5f9");
    } else {
      const headerBg = sec && parseHexColor(sec) ? sec : `color-mix(in srgb, ${bgHex} 94%, #0f172a 6%)`;
      set("--app-header-bg", headerBg);
      set("--app-header-text", text);
    }
  }

  if (t.bg_color && tw?.setHeaderColor) tw.setHeaderColor(t.bg_color);
  if (t.bg_color && tw?.setBackgroundColor) tw.setBackgroundColor(t.bg_color);
}
