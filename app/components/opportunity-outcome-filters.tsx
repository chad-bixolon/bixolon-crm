'use client';

import { useState } from 'react';
import type { OutcomeFilters, OutcomeReasonValue } from '@/lib/opportunity-outcomes';

export function OpportunityOutcomeFilters({ initial, reasons }: { initial: OutcomeFilters; reasons: OutcomeReasonValue[] }) {
  const [status, setStatus] = useState(initial.outcomeStatus === 'all' ? '' : initial.outcomeStatus ?? '');
  const [reasonId, setReasonId] = useState(initial.outcomeReasonId ?? '');
  const [from, setFrom] = useState(initial.actualCloseFrom ?? '');
  const [through, setThrough] = useState(initial.actualCloseTo ?? '');
  const [expanded, setExpanded] = useState(!!(initial.outcomeStatus && initial.outcomeStatus !== 'all' || initial.outcomeReasonId || initial.actualCloseFrom || initial.actualCloseTo));
  const matchesStatus = (reason: OutcomeReasonValue, value: string) => value === 'won' ? reason.isWon : value === 'lost' ? !reason.isWon : value !== 'open';
  // Preserve an explicitly selected reason on load, even for conflicting URL filters.
  const choices = reasons.filter(reason => matchesStatus(reason, status) || String(reason.id) === reasonId);
  const selected = reasons.find(reason => String(reason.id) === reasonId);
  const statusLabel = status === 'won' ? 'Won' : status === 'lost' ? 'Lost' : status === 'open' ? 'Open' : '';
  const summary = [statusLabel, from && `Actual close from ${from}`, through && `Actual close through ${through}`, selected?.name].filter(Boolean).join(' · ');
  const control = 'field filter-control';

  return <details className="col-span-full min-w-0" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer py-2 text-sm font-medium text-orange-800">Outcome filters{summary && <span className="ml-2 break-words font-normal text-slate-600">· {summary}</span>}</summary>
    <p className="mb-3 text-xs text-slate-600">Expected Close Date is planned timing. Actual Close Date is when the deal closed. Both date filters apply when selected.</p>
    <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="min-w-0"><label className="label" htmlFor="outcomeStatus">Status / Outcome</label><select className={control} id="outcomeStatus" name="outcomeStatus" value={status} onChange={event => {
        const value = event.target.value;
        setStatus(value);
        if (selected && !matchesStatus(selected, value)) setReasonId('');
      }}><option value="">All</option><option value="won">Won</option><option value="lost">Lost</option><option value="open">Open</option></select></div>
      <div className="min-w-0"><label className="label" htmlFor="actualCloseFrom">Actual Close Date From</label><input className={control} id="actualCloseFrom" name="actualCloseFrom" type="date" value={from} onChange={event => setFrom(event.target.value)}/></div>
      <div className="min-w-0"><label className="label" htmlFor="actualCloseTo">Actual Close Date Through</label><input className={control} id="actualCloseTo" name="actualCloseTo" type="date" value={through} onChange={event => setThrough(event.target.value)}/></div>
      <div className="min-w-0"><label className="label" htmlFor="outcomeReasonId">Outcome Reason</label><select className={control} id="outcomeReasonId" name="outcomeReasonId" value={reasonId} onChange={event => setReasonId(event.target.value)}><option value="">All reasons</option>{choices.map(reason => <option key={reason.id} value={reason.id}>{reason.isWon ? 'Won' : 'Lost'} · {reason.name}{!reason.active ? ' (Inactive)' : ''}</option>)}{reasonId && !selected && <option value={reasonId}>Selected reason unavailable</option>}</select>{status === 'open' && <p className="mt-1 text-xs text-slate-500">Open deals have no outcome reason.</p>}</div>
    </div>
  </details>;
}
