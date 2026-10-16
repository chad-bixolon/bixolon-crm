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
  return <Content><PageHeader eyebrow="Administration" title="Forecast Snapshots" description="Create and review historical forecast snapshots by quarter." action={<Link className="btn-secondary" href="/reports/forecast-snapshots">Forecast Snapshot History</Link>}/>
    <p className="panel mb-5 p-5 text-sm">Forecast snapshots use preserved Opportunity data from a selected snapshot run. Pipeline includes Pipeline, Best Case, and Commit, while Best Case and Commit remain separate totals. Closed Won is based on the captured won stage and Expected Close Date. Currencies are reported separately.</p>
    <p className="mb-3 text-xs text-slate-600">One forecast snapshot can be created per Opportunity Snapshot source and quarter. Automated scheduling is not enabled yet.</p>
    <p className="mb-5 text-sm">Select an Opportunity Snapshot that includes forecast data. The most recent eligible snapshot runs are shown below. <Link className="underline" href="/administration/opportunity-snapshots">Capture an Opportunity Snapshot</Link></p>
    <ForecastSnapshotWorkflow sources={sources.map(source => ({ id: source.id, snapshotAt: source.snapshotAt.toISOString(), opportunityCount: source.opportunityCount }))} initialPeriod={businessQuarter()}/>
    <section className="panel p-5"><h2 className="mb-3 text-lg font-semibold">Recent Forecast Snapshots</h2>{runs.length ? <ul className="divide-y">{runs.map(run => <li key={run.id} className="break-words py-3 text-sm">#{run.id} · {run.snapshotAt.toISOString()} · {run.year} {run.quarter} · Opportunity Snapshot #{run.sourceRunId} · {run.opportunityCount} Opportunities · {run.createdByName} · {run.status}</li>)}</ul> : <p className="text-sm">No forecast snapshots have been created yet.</p>}</section>
  </Content>;
}
