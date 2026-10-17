import { addCalendarDays, businessDayBounds, businessWeekBounds } from './business-date';

export const taskDuePeriods = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'next-7-days', label: 'Next 7 days' },
  { value: 'this-week', label: 'This week' },
] as const;
export type TaskDuePeriodInput = { duePeriod?: string; dueFrom?: string; dueTo?: string };
export function validTaskDuePeriod(value?: string) {
  return value === 'custom' || taskDuePeriods.some(period => period.value === value);
}
export function selectedTaskDuePeriod(input: TaskDuePeriodInput) {
  if (validTaskDuePeriod(input.duePeriod)) return input.duePeriod!;
  // Explicit Any due date clears stale custom dates. Legacy URLs have no period.
  if (input.duePeriod === '') return '';
  return input.dueFrom || input.dueTo ? 'custom' : '';
}

export function taskDuePeriodBounds(input: TaskDuePeriodInput, now = new Date()) {
  const period = selectedTaskDuePeriod(input);
  if (!period || period === 'custom') return null;
  const { start, end } = businessDayBounds(now);
  if (period === 'overdue') return { lt: start };
  if (period === 'today') return { gte: start, lt: end };
  // Match the dashboard convention: today plus seven more calendar dates.
  if (period === 'next-7-days') return { gte: start, lt: addCalendarDays(start, 8) };
  const week = businessWeekBounds(now);
  return { gte: week.start, lt: week.end };
}
