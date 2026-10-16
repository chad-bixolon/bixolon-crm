import Link from 'next/link';
import type { OpportunitySnapshot } from '@prisma/client';
import { formatCurrency } from '@/lib/display-format';

export function OpportunitySnapshotHistory({ rows, reportAccess, opportunityId }: { rows: OpportunitySnapshot[]; reportAccess: boolean; opportunityId: number }) {
  return <section className="panel mb-5 p-5" aria-labelledby="opportunity-snapshot-history-title">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold" id="opportunity-snapshot-history-title">Snapshot History</h2>{reportAccess && <Link className="text-sm text-orange-800 underline" href={`/reports/opportunity-snapshots?opportunityId=${opportunityId}`}>Compare snapshots</Link>}</div>
    {rows.length ? <ul className="divide-y text-sm">{rows.map(row => <li className="break-words py-2" key={row.id}><time dateTime={row.snapshotAt.toISOString()}>{row.snapshotAt.toISOString().slice(0, 10)}</time> · Stage: {row.stageName} · {formatCurrency(row.amount, row.currencyCode)} {row.currencyCode} · Expected close: {row.expectedCloseDate?.toISOString().slice(0, 10) ?? '—'}</li>)}</ul> : <p className="text-sm text-slate-500">No weekly snapshots captured for this Opportunity.</p>}
    <p className="mt-3 text-xs text-slate-500">Latest eight snapshots. Dates shown in UTC. {reportAccess ? '' : 'Only snapshots captured while assigned to you are shown.'}</p>
  </section>;
}
