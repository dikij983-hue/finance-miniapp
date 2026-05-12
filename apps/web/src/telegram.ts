export type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
};

export function getTelegramWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp: TelegramWebApp } }).Telegram?.WebApp;
}
