import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { assertSnapshotAdmin, FORECAST_SNAPSHOT_SCOPE } from '@/lib/opportunity-snapshots';
import { prisma } from '@/lib/prisma';
import { businessQuarter } from '@/lib/business-quarter';
import { ForecastSnapshotWorkflow } from './workflow';
export const dynamic = 'force-dynamic';
export default async function ForecastSnapshotAdministration() {
  const actor = await requirePermission('users.manage'); assertSnapshotAdmin(actor);
  const [sources, runs] = await Promise.all([
    prisma.opportunitySnapshotRun.findMany({ where: { scopeVersion: FORECAST_SNAPSHOT_SCOPE, status: 'COMPLETE' }, orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 104 }),
    prisma.forecastSnapshotRun.findMany({ orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 12 }),
  ]);
  return <Content><PageHeader eyebrow="Administration" title="Forecast Snapshots" description="Create quarterly historical rollups from a preserved Opportunity Snapshot Run." action={<Link className="btn-secondary" href="/reports/forecast-snapshots">Forecast Snapshot History</Link>}/>
    <p className="panel mb-5 p-5 text-sm">Uses only captured source values. Pipeline includes Pipeline, Best Case and Commit; Commit and Best Case are subsets. Closed Won uses won-stage status and Expected Close Date, not an actual booking date. Currencies stay separate. One immutable forecast per source run and quarter; no scheduling.</p>
    <p className="mb-5 text-sm"><Link className="underline" href="/administration/opportunity-snapshots">Create a forecast-ready Opportunity Snapshot</Link> before previewing. Source choices show the latest 104 compatible runs.</p>
    <ForecastSnapshotWorkflow sources={sources.map(source => ({ id: source.id, snapshotAt: source.snapshotAt.toISOString(), opportunityCount: source.opportunityCount }))} initialPeriod={businessQuarter()}/>
    <section className="panel p-5"><h2 className="mb-3 text-lg font-semibold">Recent Forecast Snapshot runs</h2>{runs.length ? <ul className="divide-y">{runs.map(run => <li key={run.id} className="break-words py-3 text-sm">#{run.id} · {run.snapshotAt.toISOString()} · {run.year} {run.quarter} · source #{run.sourceRunId} · {run.opportunityCount} Opportunities · {run.createdByName} · {run.status}</li>)}</ul> : <p className="text-sm">No Forecast Snapshots yet.</p>}</section>
  </Content>;
}
