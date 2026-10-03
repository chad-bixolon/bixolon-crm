import { formatCalendarDate } from './display-format';

export function formatSnapshotWeekQuery(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? formatCalendarDate(date) : null;
}

export function countLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

export function captureFeedback(count: number, week: string): string {
  return `Captured ${countLabel(count, 'rep snapshot', 'rep snapshots')} for the week of ${week}.`;
}

export function existingCaptureFeedback(week: string): string {
  return `Snapshots for the week of ${week} were already captured.`;
}
