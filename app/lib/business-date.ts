/** New York calendar dates encoded at UTC midnight for date-only comparisons.
 * These are calendar labels, not the instant of midnight in New York.
 */
export function businessToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00.000Z`);
}

export function addCalendarDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function businessDayBounds(now = new Date()) {
  const start = businessToday(now);
  return { start, end: addCalendarDays(start, 1) };
}

/** Existing SalesHub snapshot convention: Monday through Sunday. */
export function businessWeekBounds(now = new Date()) {
  const today = businessToday(now);
  const start = addCalendarDays(today, -((today.getUTCDay() + 6) % 7));
  return { start, end: addCalendarDays(start, 7) };
}
