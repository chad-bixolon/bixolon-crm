type Money = number | { toNumber(): number };

export function formatCurrency(value: Money, currency: string, showCode = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: currency === "USD" && !showCode ? "symbol" : "code",
  }).format(typeof value === "number" ? value : value.toNumber()).replace(/\u00a0/g, " ");
}

export function formatCloseMonth(month: string): string {
  if (month === "Unscheduled") return month;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
}
