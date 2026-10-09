'use client';

import { useState } from 'react';
import { formatDateTimeForUser } from '@/lib/display-format';
import { supportEventFields, supportEventValue, supportHistoryItems, type SupportHistoryEvent } from '@/lib/support-case-display';

const label = (field: string) => field === 'resolvedAt' ? 'Resolved at' : field === 'closedAt' ? 'Closed at' : supportEventFields[field] ?? 'Case updated';
function AuditChange({ event, zone }: { event: SupportHistoryEvent; zone: string }) {
  const change = `${supportEventValue(event.field, event.oldValue, event.oldLabel, zone)} → ${supportEventValue(event.field, event.newValue, event.newLabel, zone)}`;
  return change.length > 320
    ? <details className="mt-2 min-w-0 break-words whitespace-pre-wrap text-slate-700"><summary className="cursor-pointer">{change.slice(0, 240)}… <span className="text-orange-800">Read full change</span></summary><p className="mt-2">{change}</p></details>
    : <p className="mt-2 break-words whitespace-pre-wrap text-slate-700">{change}</p>;
}

export function SupportCaseHistory({ events, caseCreatedAt, viewerId, zone, caseId, truncated = false }: {
  events: readonly SupportHistoryEvent[]; caseCreatedAt: Date; viewerId: number; zone: string; caseId: number; truncated?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `case-audit-${caseId}`;
  const items = supportHistoryItems([...events].sort((a, b) => a.id - b.id), caseCreatedAt).reverse();
  return <section className="panel p-4 sm:p-5" aria-label="Audit History">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Audit History · {events.length}</h2>
      <button type="button" className="btn-secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>{open ? 'Hide audit history' : 'Show audit history'}</button>
    </div>
    {open && <div id={panelId} className="mt-4">
      {events.length ? <ol className="divide-y divide-slate-100">{items.map(item => {
        const event = item.event;
        return <li key={event.id} className="min-w-0 py-3 text-sm">
          <h3 className="font-semibold">{item.kind === 'creation' ? 'Case created · Initial values' : event.field === 'CREATED' ? 'Case created' : event.source === 'ARCHIVE' ? 'Case archived' : event.source === 'RESTORE' ? 'Case restored' : `${label(event.field)} changed`}</h3>
          <p className="mt-1 text-xs text-slate-500">{formatDateTimeForUser(event.createdAt, zone)} · {event.actorId === viewerId ? 'You' : `${event.actor.firstName} ${event.actor.lastName}`}</p>
          {item.kind === 'creation' ? <dl className="mt-2 space-y-1">{item.fields.map(field => {
            const value = supportEventValue(field.field, field.newValue, field.newLabel, zone);
            return <div key={field.id} className="grid min-w-0 gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
              <dt className="font-medium text-slate-600">{label(field.field)}</dt>
              <dd className="min-w-0 break-words whitespace-pre-wrap">{['description', 'resolutionSummary'].includes(field.field) && value.length > 240
                ? <details><summary className="cursor-pointer break-words">{value.slice(0, 240)}… <span className="text-orange-800">Read full text</span></summary><p className="mt-2 break-words whitespace-pre-wrap">{value}</p></details>
                : value}</dd>
            </div>;
          })}</dl> : event.field !== 'CREATED' && <AuditChange event={event} zone={zone}/>}
        </li>;
      })}</ol> : <p className="text-sm text-slate-500">No audit entries yet.</p>}
      {truncated && <p className="mt-3 text-xs text-slate-500">Showing the 80 most recent audit entries.</p>}
    </div>}
  </section>;
}
