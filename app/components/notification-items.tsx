import { dismissNotification, markNotificationRead, openNotification } from '@/app/notifications/actions';
import type { NotificationItem } from '@/lib/notifications';

const severityStyle = { INFO: 'bg-sky-50 text-sky-800', WARNING: 'bg-amber-50 text-amber-900', CRITICAL: 'bg-red-50 text-red-800' };
const severityLabels = { INFO: 'Info', WARNING: 'Warning', CRITICAL: 'Critical' };
const categories = { PRICE_EXCEPTION: 'Price Exception', TASK: 'Task', OPPORTUNITY: 'Opportunity', DEMO: 'Demo', PROJECT: 'Project', TRADE_SHOW: 'Trade Show', CAMPAIGN: 'Campaign' };
function friendlyNotificationTime(date: Date) { const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000)); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`; }
export function NotificationItems({ rows, compact = false }: { rows: NotificationItem[]; compact?: boolean }) {
  return <div className="divide-y divide-slate-100">{rows.map(row => <article key={row.id} className={`min-w-0 px-4 py-3 ${row.readAt ? '' : 'bg-orange-50/40'}`}>
    <div className="flex items-start justify-between gap-2"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${severityStyle[row.severity]}`}>{severityLabels[row.severity]}</span><time className="shrink-0 text-xs text-slate-500" dateTime={row.createdAt.toISOString()}>{friendlyNotificationTime(row.createdAt)}</time></div>
    <form action={openNotification} className="mt-2"><input type="hidden" name="id" value={row.id}/><button className="text-left text-sm font-semibold text-slate-900 hover:text-orange-800 hover:underline">{row.title}</button></form>
    <p className="mt-1 break-words text-xs leading-5 text-slate-600">{row.message}</p>
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs"><span className="text-slate-500">{categories[row.entityType]} #{row.entityId}</span>{!row.readAt&&<form action={markNotificationRead}><input type="hidden" name="id" value={row.id}/><button className="text-orange-800 hover:underline">Mark read</button></form>}{!row.dismissedAt&&!row.resolvedAt&&<form action={dismissNotification}><input type="hidden" name="id" value={row.id}/><button className="text-slate-600 hover:underline">Dismiss</button></form>}{!compact&&<form action={openNotification}><input type="hidden" name="id" value={row.id}/><button className="text-orange-800 hover:underline">Open {categories[row.entityType]}</button></form>}</div>
  </article>)}</div>;
}
