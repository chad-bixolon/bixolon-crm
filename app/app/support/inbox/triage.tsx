'use client';

import { useState, type ReactNode } from 'react';
import { inboxMatchesView, inboxScopeWording, inboxTriageCounts, inboxTriageViews, type InboxTriageState, type InboxTriageView } from '@/lib/support-inbox-display';

type Row = InboxTriageState & { id: string; content: ReactNode };

// Server-rendered messages from one bounded fetch. View changes stay local.
export function InboxTriage({ rows, limit, lookbackDays, actions }: { rows: Row[]; limit: number; lookbackDays: number; actions: ReactNode }) {
  const [view, setView] = useState<InboxTriageView>('all');
  const counts = inboxTriageCounts(rows);
  const shown = rows.filter(row => inboxMatchesView(row, view));
  return <section aria-label="Recent Inbox batch">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div role="group" aria-label="Inbox triage views" className="flex flex-wrap gap-1">
        {inboxTriageViews.map(({ id, label }) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} title={id === 'needs-review' ? 'Unlinked messages with ambiguous or conflicting CRM matches' : undefined} className={`min-h-11 whitespace-nowrap rounded-md border px-2 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-orange-600 ${view === id ? 'border-orange-700 bg-orange-50 text-orange-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{label} <span className="ml-1 tabular-nums">{counts[id]}</span></button>)}
      </div>
      {actions}
    </div>
    <p role="status" className="mb-1 text-xs text-slate-600">{inboxScopeWording(shown.length, limit, lookbackDays)}</p>
    <p className="mb-3 text-xs text-slate-500">Views filter this batch; ignored messages are separate.</p>
    <div className="space-y-3">{rows.map(row => <div key={row.id} hidden={!inboxMatchesView(row, view)}>{row.content}</div>)}
      {!shown.length && <p className="panel p-5">No messages match this view within the current batch.</p>}
    </div>
  </section>;
}
