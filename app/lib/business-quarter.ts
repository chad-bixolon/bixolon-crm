import { SalesQuarter } from '@prisma/client';

export const quarters = Object.values(SalesQuarter);

export function businessQuarter(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const read = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: read('year'), quarter: `Q${Math.floor((read('month') - 1) / 3) + 1}` as SalesQuarter };
}

export function quarterBounds(year: number, quarter: SalesQuarter) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !quarters.includes(quarter)) throw new Error('Choose a valid year and quarter.');
  const month = quarters.indexOf(quarter) * 3;
  // Date-only expected close dates are stored at noon UTC. UTC calendar
  // boundaries include every New York business date, including DST days.
  return { start: new Date(Date.UTC(year, month, 1)), endExclusive: new Date(Date.UTC(year, month + 3, 1)) };
}
