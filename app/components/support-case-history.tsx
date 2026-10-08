import { formatDateTimeForUser } from '@/lib/display-format';
import { supportEventFields, supportEventValue, supportHistoryItems, type SupportHistoryEvent } from '@/lib/support-case-display';

export function SupportCaseHistory({ events, caseCreatedAt, viewerId, zone }: {
  events: readonly SupportHistoryEvent[]; caseCreatedAt: Date; viewerId: number; zone: string;
}) {
  const items = supportHistoryItems(events, caseCreatedAt);
  return <details className="panel p-5">
    <summary className="cursor-pointer text-lg font-semibold">Case History ({events.length} events)</summary>
    <ol className="mt-4 space-y-3">{items.map(item => {
      const event = item.event;
      return <li key={event.id} className="border-t border-slate-100 pt-3 text-sm">
        <strong>{item.kind === 'creation' ? 'Case created' : event.source === 'ARCHIVE' ? 'Archived case' : event.source === 'RESTORE' ? 'Restored case' : supportEventFields[event.field] ?? 'Case updated'}</strong>
        <div className="mt-1 text-slate-500">{formatDateTimeForUser(event.createdAt, zone)} · {event.actorId === viewerId ? 'You' : `${event.actor.firstName} ${event.actor.lastName}`}</div>
        {item.kind === 'creation' ? <dl className="mt-3 space-y-1.5">{item.fields.map(field => {
          const value = supportEventValue(field.field, field.newValue, field.newLabel, zone);
          return <div key={field.id} className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
            <dt className="font-medium text-slate-600">{supportEventFields[field.field]}</dt>
            <dd className="min-w-0 break-words whitespace-pre-wrap">{field.field === 'description' && value.length > 240
              ? <details><summary className="cursor-pointer break-words">{value.slice(0, 240)}… <span className="text-orange-800">Read full description</span></summary><p className="mt-2 break-words whitespace-pre-wrap">{value}</p></details>
              : value}</dd>
          </div>;
        })}</dl> : event.field !== 'CREATED' && event.field !== 'archivedAt' && <div className="mt-1 break-words whitespace-pre-wrap">{supportEventValue(event.field, event.oldValue, event.oldLabel, zone)} → {supportEventValue(event.field, event.newValue, event.newLabel, zone)}</div>}
      </li>;
    })}</ol>
  </details>;
}
