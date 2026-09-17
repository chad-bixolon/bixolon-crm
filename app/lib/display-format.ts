type Money = number | { toNumber(): number };

export function formatCurrency(value: Money, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(typeof value === "number" ? value : value.toNumber());
}

export function formatCloseMonth(month: string): string {
  if (month === "Unscheduled") return month;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
}
