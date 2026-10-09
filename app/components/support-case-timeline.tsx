'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatDateTimeForUser } from '@/lib/display-format';
import type { CaseTimelineItem } from '@/lib/support-case-timeline';

export function SupportCaseTimeline({ items, zone, caseId }: { items: CaseTimelineItem[]; zone: string; caseId: number }) {
  const [open, setOpen] = useState(false);
  const panelId = `case-timeline-${caseId}`;
  return <section className="panel mb-5 p-4 sm:p-5" aria-label="Case Timeline">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Case Timeline · {items.length}</h2>
      <button type="button" className="btn-secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>{open ? 'Hide timeline' : 'Show timeline'}</button>
    </div>
    {open && <div id={panelId} className="mt-4">{items.length ? <ol className="divide-y divide-slate-100">{items.map(item => <li key={item.key} className="min-w-0 py-4 text-sm">
      <h3 className="font-semibold text-slate-900">{item.href ? <Link href={item.href} className="text-orange-800 hover:underline">{item.title}</Link> : item.title}</h3>
      <p className="mt-1 text-xs text-slate-500">{formatDateTimeForUser(item.at, zone)}{item.actor ? ` · ${item.actor}` : ''}</p>
      {item.detail && <p className="mt-2 break-words whitespace-pre-wrap text-slate-700">{item.detail}</p>}
      {!!item.summary?.length && <dl className="mt-2 grid gap-1 text-slate-700 sm:grid-cols-2">{item.summary.map(field => <div key={field.label} className="min-w-0 break-words"><dt className="inline font-medium">{field.label}: </dt><dd className="inline whitespace-pre-wrap">{field.value}</dd></div>)}</dl>}
    </li>)}</ol> : <p className="text-sm text-slate-500">No timeline items yet.</p>}</div>}
  </section>;
}
