import { businessQuarter, quarterBounds } from './business-quarter';

export type ClosePeriodInput = { closePeriod?: string; closeFrom?: string; closeTo?: string };
const explicit = /^(20\d{2})-Q([1-4])$/;
export function validClosePeriod(value?: string) {
  if (value === 'current-quarter' || value === 'next-quarter' || value === 'previous-quarter' || value === 'custom') return true;
  const match = value?.match(explicit);
  return !!match && Number(match[1]) <= 2100;
}

export function selectedClosePeriod(input: ClosePeriodInput) {
  if (validClosePeriod(input.closePeriod)) return input.closePeriod!;
  return input.closeFrom || input.closeTo ? 'custom' : '';
}

export function nearbyCloseQuarters(now = new Date()) {
  const { year, quarter } = businessQuarter(now);
  const current = year * 4 + Number(quarter.slice(1)) - 1;
  return [-1, 0, 1, 2, 3, 4].map(offset => {
    const index = current + offset;
    return `${Math.floor(index / 4)}-Q${index % 4 + 1}`;
  });
}

export function closePeriodBounds(input: ClosePeriodInput, now = new Date()) {
  const selected = selectedClosePeriod(input);
  if (selected === 'custom') {
    const validDate = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
    const from = validDate(input.closeFrom) ? new Date(`${input.closeFrom}T00:00:00Z`) : null;
    const through = validDate(input.closeTo) ? new Date(`${input.closeTo}T23:59:59.999Z`) : null;
    return from || through ? { ...(from ? { gte: from } : {}), ...(through ? { lte: through } : {}) } : null;
  }
  if (!selected) return null;
  const current = businessQuarter(now);
  const offset = selected === 'current-quarter' ? 0 : selected === 'next-quarter' ? 1 : selected === 'previous-quarter' ? -1 : null;
  const index = offset === null ? Number(selected.slice(0, 4)) * 4 + Number(selected.slice(-1)) - 1 : current.year * 4 + Number(current.quarter.slice(1)) - 1 + offset;
  const { start, endExclusive } = quarterBounds(Math.floor(index / 4), `Q${index % 4 + 1}` as typeof current.quarter);
  return { gte: start, lt: endExclusive };
}
