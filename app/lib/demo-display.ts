const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const demoDisplayDate = (value: Date) => dateFormatter.format(value);

export function demoStatusLabel(status: string) {
  return status === 'PENDING' ? 'Requested' : status.charAt(0) + status.slice(1).toLowerCase();
}

export function demoDuration(value: number | null, unit: string | null) {
  if (value === null || !unit) return '—';
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

export function demoDatedBy(value: Date | null, user: { firstName: string; lastName: string } | null) {
  if (!value) return '—';
  return `${demoDisplayDate(value)}${user ? ` · ${user.firstName} ${user.lastName}` : ''}`;
}
