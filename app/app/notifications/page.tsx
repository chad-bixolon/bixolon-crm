import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { NotificationItems } from '@/components/notification-items';
import { dismissAllRead, markAllRead } from './actions';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { notificationBulkActionAvailability, notificationPage, notificationViews, notificationCategories, type NotificationView, type NotificationCategory } from '@/lib/notifications';
import type { NotificationSeverity } from '@prisma/client';

const labels: Record<NotificationView, string> = { active: 'Active', unread: 'Unread', all: 'History', dismissed: 'Dismissed', resolved: 'Resolved' };
const categories: Record<NotificationCategory, string> = { all: 'All', 'price-exceptions': 'Price Exceptions', tasks: 'Tasks', opportunities: 'Opportunities', support: 'Support' };
const emptyStates: Record<NotificationView, [string, string]> = {
  active: ['No active notifications', "You don't have anything requiring attention right now."],
  unread: ['No unread notifications', "You're caught up on unread notifications."],
  all: ['No notification history', 'Notifications you receive will appear here.'],
  dismissed: ['No dismissed notifications', 'Dismissed notifications will appear here.'],
  resolved: ['No resolved notifications', 'Resolved notifications will appear here.'],
};
const filterClass = (selected: boolean) => `btn-secondary gap-1.5 ${selected ? 'ring-2 ring-orange-600' : ''}`;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ view?: string; category?: string; severity?: string; page?: string }> }) {
  const actor = await currentUser();
  const params = await searchParams;
  const view = notificationViews.includes(params.view as NotificationView) ? params.view as NotificationView : 'active';
  const category = notificationCategories.includes(params.category as NotificationCategory) ? params.category as NotificationCategory : 'all';
  const severity = ['INFO', 'WARNING', 'CRITICAL'].includes(params.severity ?? '') ? params.severity as NotificationSeverity : undefined;
  const href = (page: number, state = view, group = category, level = severity) => `/notifications?view=${state}&category=${group}&severity=${level ?? ''}&page=${page}`;
  const [result, bulk] = await Promise.all([
    notificationPage(prisma, actor, view, Number(params.page) || 1, 20, category, severity),
    notificationBulkActionAvailability(prisma, actor),
  ]);
  const [emptyTitle, emptyDescription] = emptyStates[view];

  return <Content>
    <PageHeader eyebrow="Notifications" title="Notification Center" description="Stay on top of tasks, opportunities, price exceptions, and Support Cases that need your attention." action={<div className="page-header-actions"><form action={markAllRead}><button className="btn-secondary" disabled={!bulk.canMarkAllRead}>Mark all read</button></form><form action={dismissAllRead}><button className="btn-secondary" disabled={!bulk.canDismissRead}>Dismiss read</button></form></div>}/>
    <section className="panel filter-panel mb-4 space-y-3" aria-label="Notification filters">
      <div className="flex flex-wrap items-start gap-2 sm:gap-3"><h2 className="w-full text-xs font-semibold uppercase tracking-wide text-slate-600 sm:w-20 sm:pt-3">Status</h2><nav aria-label="Notification state" className="flex min-w-0 flex-1 flex-wrap gap-2">{notificationViews.map(option => <Link key={option} href={href(1, option)} aria-current={view === option ? 'page' : undefined} className={filterClass(view === option)}>{view === option && <span aria-hidden="true">✓</span>}{labels[option]}</Link>)}</nav></div>
      <div className="flex flex-wrap items-start gap-2 sm:gap-3"><h2 className="w-full text-xs font-semibold uppercase tracking-wide text-slate-600 sm:w-20 sm:pt-3">Category</h2><nav aria-label="Notification category" className="flex min-w-0 flex-1 flex-wrap gap-2">{notificationCategories.map(option => <Link key={option} href={href(1, view, option)} aria-current={category === option ? 'page' : undefined} className={filterClass(category === option)}>{category === option && <span aria-hidden="true">✓</span>}{categories[option]}</Link>)}</nav></div>
      <form className="flex flex-wrap items-end gap-2 sm:gap-3"><input type="hidden" name="view" value={view}/><input type="hidden" name="category" value={category}/><label htmlFor="notification-severity" className="w-full text-xs font-semibold uppercase tracking-wide text-slate-600 sm:w-20 sm:self-center">Severity</label><div className="w-full sm:w-48"><select id="notification-severity" name="severity" className="field" defaultValue={severity ?? ''}>{['', 'INFO', 'WARNING', 'CRITICAL'].map(option => <option key={option} value={option}>{option || 'All severities'}</option>)}</select></div><button className="btn-primary">Apply</button></form>
    </section>
    <section className="panel overflow-hidden">{result.rows.length ? <NotificationItems rows={result.rows}/> : <div className="p-4"><h2 className="text-sm font-semibold text-slate-900">{emptyTitle}</h2><p className="mt-1 text-sm text-slate-600">{emptyDescription}</p></div>}</section>
    {result.pages > 1 && <nav aria-label="Notification pages" className="mt-4 flex items-center gap-4 text-sm"><span>Page {result.page} of {result.pages}</span>{result.page > 1 && <Link className="text-orange-800 underline" href={href(result.page - 1)}>Previous</Link>}{result.page < result.pages && <Link className="text-orange-800 underline" href={href(result.page + 1)}>Next</Link>}</nav>}
  </Content>;
}
