import type { Actor } from './authorization';

export const openStatuses = ['OPEN', 'IN_PROGRESS'] as const;
export function daysSince(date: Date | null, now = new Date()) {
  return date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000)) : null;
}
export function engagementState(date: Date | null, threshold: number, now = new Date()) {
  const days = daysSince(date, now);
  return days === null ? 'No activity ever' : days >= threshold ? 'Stale' : 'Active / recent';
}
export function lookbackStart(days: number, now = new Date()) { return new Date(now.getTime() - days * 86400000); }
export function repAccountSummary(accounts: { activities: { activityDate: Date }[] }[], threshold: number, now = new Date()) {
  return { owned: accounts.length, withoutRecentActivity: accounts.filter(a => engagementState(a.activities[0]?.activityDate ?? null, threshold, now) !== 'Active / recent').length };
}
export function reportAccountScope(actor: Actor) {
  if (!['ADMIN', 'SALES_MANAGER', 'SALES'].includes(actor.role)) throw new Error('Access denied');
  return actor.role === 'SALES' ? { ownerId: actor.id } : {};
}
export function taskRollup(tasks: { status: string; dueDate: Date | null; archivedAt: Date | null }[], today: Date) {
  const open = tasks.filter(t => !t.archivedAt && openStatuses.some(s => s === t.status));
  return { open: open.length, overdue: open.filter(t => t.dueDate && t.dueDate < today).length };
}
