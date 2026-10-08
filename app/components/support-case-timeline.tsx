import Link from 'next/link';
import { formatDateTimeForUser } from '@/lib/display-format';
import type { CaseTimelineItem } from '@/lib/support-case-timeline';

export function SupportCaseTimeline({ items, zone }: { items: CaseTimelineItem[]; zone: string }) {
  return <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Case timeline</h2><p className="mb-3 text-xs text-slate-500">Showing the 80 most recent items, with up to 40 from each source.</p>{items.length ? <ol className="divide-y divide-slate-100">{items.map(item => <li key={item.key} className="py-4 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{item.source}</span><span className="text-slate-500">{formatDateTimeForUser(item.at, zone)}</span></div><p className="mt-2 font-medium">{item.href ? <Link href={item.href} className="text-orange-800 hover:underline">{item.title}</Link> : item.title}</p>{item.detail && <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{item.detail}</p>}{item.actor && <p className="mt-1 text-xs text-slate-500">{item.actor}</p>}</li>)}</ol> : <p className="text-sm text-slate-500">No timeline items yet.</p>}</section>;
}
