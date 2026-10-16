/** New York calendar date, represented at UTC midnight for date-only comparisons.
 * Stored PE dates are compared as saved; this never shifts or rewrites them.
 */
export function businessToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00.000Z`);
}

export function isPriceExceptionExpired(expirationDate: Date | null, now = new Date()) {
  return expirationDate !== null && expirationDate < businessToday(now);
}
