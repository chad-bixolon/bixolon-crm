export function calendarLocalInput(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (kind: string) => parts.find(part => part.type === kind)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function calendarLocalToUtc(local: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const naive = new Date(`${local}:00Z`);
  if (Number.isNaN(naive.getTime()) || naive.toISOString().slice(0, 16) !== local) return null;
  const matches: Date[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(naive.getTime() - offset * 60000);
    if (calendarLocalInput(candidate, timeZone) === local) matches.push(candidate);
  }
  return matches[0] ?? null;
}
