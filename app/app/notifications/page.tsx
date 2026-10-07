import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { NotificationItems } from '@/components/notification-items';
import { dismissAllRead, markAllRead } from './actions';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { notificationPage, notificationViews, notificationCategories, type NotificationView, type NotificationCategory } from '@/lib/notifications';
import type { NotificationSeverity } from '@prisma/client';

const labels: Record<NotificationView, string> = { active: 'Active', unread: 'Unread', all: 'All / History', dismissed: 'Dismissed', resolved: 'Resolved' };
const categories: Record<NotificationCategory, string> = { all: 'All', 'price-exceptions': 'Price Exceptions', tasks: 'Tasks', opportunities: 'Opportunities' };
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ view?: string; category?: string; severity?: string; page?: string }> }) {
  const actor = await currentUser();
  const params = await searchParams;
  const view = notificationViews.includes(params.view as NotificationView) ? params.view as NotificationView : 'active';
  const category = notificationCategories.includes(params.category as NotificationCategory) ? params.category as NotificationCategory : 'all';
  const severity = ['INFO', 'WARNING', 'CRITICAL'].includes(params.severity ?? '') ? params.severity as NotificationSeverity : undefined;
  const href = (page: number, state = view, group = category, level = severity) => `/notifications?view=${state}&category=${group}&severity=${level ?? ''}&page=${page}`;
  const result = await notificationPage(prisma, actor, view, Number(params.page) || 1, 20, category, severity);
  return <Content><PageHeader eyebrow="Personal attention queue" title="Notification Center" description="Your personal Task, Opportunity, and Price Exception alerts." action={<div className="page-header-actions"><form action={markAllRead}><button className="btn-secondary">Mark all read</button></form><form action={dismissAllRead}><button className="btn-secondary">Dismiss all read</button></form></div>}/>
    <div className="mb-5 space-y-3"><nav aria-label="Notification state" className="flex flex-wrap gap-2">{notificationViews.map(option => <Link key={option} href={href(1, option)} aria-current={view === option ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm ${view === option ? 'bg-orange-100 font-semibold text-orange-900' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{labels[option]}</Link>)}</nav><nav aria-label="Notification category" className="flex flex-wrap gap-2">{notificationCategories.map(option => <Link key={option} href={href(1, view, option)} aria-current={category === option ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm ${category === option ? 'bg-orange-100 font-semibold text-orange-900' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{categories[option]}</Link>)}</nav><form className="flex flex-wrap items-center gap-2 text-sm"><input type="hidden" name="view" value={view}/><input type="hidden" name="category" value={category}/><label htmlFor="notification-severity">Severity</label><select id="notification-severity" name="severity" className="field max-w-40" defaultValue={severity ?? ''}>{['', 'INFO', 'WARNING', 'CRITICAL'].map(option => <option key={option} value={option}>{option || 'All'}</option>)}</select><button className="btn-primary">Apply</button></form></div>
    <section className="panel overflow-hidden">{result.rows.length ? <NotificationItems rows={result.rows}/> : <p className="p-5 text-sm text-slate-600">{view === 'active' ? 'No active notifications.' : 'No notification history yet.'}</p>}</section>
    {result.pages > 1 && <nav aria-label="Notification pages" className="mt-4 flex items-center gap-4 text-sm"><span>Page {result.page} of {result.pages}</span>{result.page > 1 && <Link className="text-orange-800 underline" href={href(result.page - 1)}>Previous</Link>}{result.page < result.pages && <Link className="text-orange-800 underline" href={href(result.page + 1)}>Next</Link>}</nav>}
  </Content>;
}
