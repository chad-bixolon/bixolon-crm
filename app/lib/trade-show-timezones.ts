export const TRADE_SHOW_TIMEZONE_GROUPS = [
  {
    label: 'United States',
    options: [
      { label: 'Eastern Time', value: 'America/New_York' },
      { label: 'Central Time', value: 'America/Chicago' },
      { label: 'Mountain Time', value: 'America/Denver' },
      { label: 'Arizona', value: 'America/Phoenix' },
      { label: 'Pacific Time', value: 'America/Los_Angeles' },
      { label: 'Alaska', value: 'America/Anchorage' },
      { label: 'Hawaii', value: 'Pacific/Honolulu' },
    ],
  },
  {
    label: 'Canada',
    options: [
      { label: 'Atlantic Canada', value: 'America/Halifax' },
      { label: 'Newfoundland', value: 'America/St_Johns' },
      { label: 'Saskatchewan', value: 'America/Regina' },
    ],
  },
  {
    label: 'Mexico',
    options: [
      { label: 'Mexico City / Central Mexico', value: 'America/Mexico_City' },
      { label: 'Northwest Mexico', value: 'America/Hermosillo' },
      { label: 'Tijuana / Baja California', value: 'America/Tijuana' },
    ],
  },
] as const;

const approvedTimezones = new Set<string>(TRADE_SHOW_TIMEZONE_GROUPS.flatMap(group => group.options.map(option => option.value)));
const timezoneLabels = new Map<string, string>(TRADE_SHOW_TIMEZONE_GROUPS.flatMap(group => group.options.map(option => [option.value, option.label] as const)));

export function isApprovedTradeShowTimezone(value: string): boolean {
  return approvedTimezones.has(value);
}

export function tradeShowTimezoneLabel(value: string | null): string {
  return value ? timezoneLabels.get(value) ?? value : '—';
}
