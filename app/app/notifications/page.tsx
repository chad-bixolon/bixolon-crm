import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { NotificationItems } from '@/components/notification-items';
import { dismissAllRead, markAllRead } from './actions';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { notificationPage, notificationViews, type NotificationView } from '@/lib/notifications';

const labels: Record<NotificationView, string> = { active: 'Active', unread: 'Unread', all: 'All / History', dismissed: 'Dismissed', resolved: 'Resolved' };
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const actor = await currentUser();
  const params = await searchParams;
  const view = notificationViews.includes(params.view as NotificationView) ? params.view as NotificationView : 'active';
  const result = await notificationPage(prisma, actor, view, Number(params.page) || 1);
  const href = (page: number) => `/notifications?view=${view}&page=${page}`;
  return <Content><PageHeader eyebrow="Personal attention queue" title="Notification Center" description="Dismiss alerts without changing the underlying Price Exception." action={<div className="flex flex-wrap gap-2"><form action={markAllRead}><button className="btn-secondary">Mark all read</button></form><form action={dismissAllRead}><button className="btn-secondary">Dismiss all read</button></form></div>}/>
    <nav aria-label="Notification filters" className="mb-5 flex flex-wrap gap-2">{notificationViews.map(option => <Link key={option} href={`/notifications?view=${option}`} aria-current={view === option ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm ${view === option ? 'bg-orange-100 font-semibold text-orange-900' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{labels[option]}</Link>)}</nav>
    <section className="panel overflow-hidden">{result.rows.length ? <NotificationItems rows={result.rows}/> : <p className="p-5 text-sm text-slate-600">{view === 'active' ? 'No active notifications.' : 'No notification history yet.'}</p>}</section>
    {result.pages > 1 && <nav aria-label="Notification pages" className="mt-4 flex items-center gap-4 text-sm"><span>Page {result.page} of {result.pages}</span>{result.page > 1 && <Link className="text-orange-800 underline" href={href(result.page - 1)}>Previous</Link>}{result.page < result.pages && <Link className="text-orange-800 underline" href={href(result.page + 1)}>Next</Link>}</nav>}
  </Content>;
}
