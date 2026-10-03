type Money = number | { toNumber(): number };

const calendarDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const easternDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const easternTimeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export function formatCalendarDate(value: Date): string { return calendarDateFormatter.format(value); }
export function formatEasternDate(value: Date): string { return easternDateFormatter.format(value); }
export function formatEasternDateTime(value: Date): string { return `${formatEasternDate(value)} at ${easternTimeFormatter.format(value)}`; }

export function formatCurrency(value: Money, currency: string, showCode = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: currency === "USD" && !showCode ? "symbol" : "code",
  }).format(typeof value === "number" ? value : value.toNumber()).replace(/\u00a0/g, " ");
}

export function formatCurrencyOrDash(value: Money, currency: string | null, showCode = false): string {
  return currency === null ? "—" : formatCurrency(value, currency, showCode);
}

// Intl accepts decimal strings without rounding them through a JavaScript number.
export function formatPlanCurrency(value: { toString(): string } | string, currency: string): string {
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: currency === "USD" ? "symbol" : "code",
    minimumFractionDigits: /\.\d*[1-9]/.test(value.toString()) ? digits : 0,
    maximumFractionDigits: digits,
  }).format(value.toString() as unknown as number).replace(/\u00a0/g, " ");
}

export function formatPlanNumber(value: { toString(): string } | string | null): string {
  if (value === null) return "—";
  const raw = value.toString();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return `${match[1]}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatPlanPercent(value: number): string {
  return `${Number(value.toFixed(1))}%`;
}

export function formatCloseMonth(month: string): string {
  if (month === "Unscheduled") return month;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
}
