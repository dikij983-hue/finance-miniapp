/** Отображение денег из minor units (копейки). */
export function formatMoney(minor: number, currencyCode: string): string {
  const amount = minor / 100;
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currencyCode.length === 3 ? currencyCode : "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currencyCode}`;
  }
}

export function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
