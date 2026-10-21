'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatDateTimeForUser } from '@/lib/display-format';
import type { CaseTimelineItem } from '@/lib/support-case-timeline';

export function CaseTimelineEntry({ item, zone }: { item: CaseTimelineItem; zone: string }) {
  const label = item.kind || (item.source === 'Case' ? 'Case Update' : item.source);
  const color = item.kind === 'Email Response Logged' ? 'bg-orange-50 text-orange-800' : item.kind === 'Inbound Email' ? 'bg-sky-50 text-sky-800' : 'bg-slate-100 text-slate-600';
  return <li className="min-w-0 py-4 text-sm">
    {item.title !== label && <span className={`mb-1 inline-block rounded px-2 py-0.5 text-xs ${color}`}>{label}</span>}
    <h3 className="break-words font-semibold text-slate-900">{item.title === label ? <span className={`inline-block rounded px-2 py-0.5 ${color}`}>{item.href ? <Link href={item.href}>{item.title}</Link> : item.title}</span> : item.href ? <Link href={item.href} className="text-orange-800 hover:underline">{item.title}</Link> : item.title}</h3>
    {item.actor && <p className="mt-1 break-words text-sm text-slate-700">{item.actor}</p>}
    <p className="mt-1 text-xs text-slate-500">{formatDateTimeForUser(item.at, zone)}</p>
    {item.detail && <p className="mt-2 break-words whitespace-pre-wrap text-slate-700">{item.detail}</p>}
    {item.noteHref && <Link className="mt-2 inline-flex font-medium text-orange-800 underline" href={item.noteHref}>View full note</Link>}
    {item.unavailable && <p className="mt-2 text-slate-500">{item.unavailable}</p>}
    {item.fullBody && <details className="mt-2"><summary className="cursor-pointer text-orange-800">Read full email</summary><p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{item.fullBody}</p></details>}
    {!!item.summary?.length && <dl className="mt-2 grid gap-1 text-slate-700 sm:grid-cols-2">{item.summary.map(field => <div key={field.label} className="min-w-0 break-words"><dt className="inline font-medium">{field.label}: </dt><dd className="inline whitespace-pre-wrap">{field.value}</dd></div>)}</dl>}
  </li>;
}
export function SupportCaseTimeline({ items, zone, caseId }: { items: CaseTimelineItem[]; zone: string; caseId: number }) {
  const [open, setOpen] = useState(false);
  const panelId = `case-timeline-${caseId}`;
  return <section className="panel mb-5 p-4 sm:p-5" aria-label="Case Timeline">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Case Timeline · {items.length}</h2>
      <button type="button" className="btn-secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>{open ? 'Hide timeline' : 'Show timeline'}</button>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600"><p>Recent activity · Newest first</p><Link className="font-medium text-orange-800 underline" href={`/support/cases/${caseId}/history`}>View older history</Link></div>
    {open && <div id={panelId} className="mt-4">{items.length ? <ol className="divide-y divide-slate-100">{items.map(item => <CaseTimelineEntry key={item.key} item={item} zone={zone}/>)}</ol> : <p className="text-sm text-slate-500">No timeline items yet.</p>}</div>}
  </section>;
}
