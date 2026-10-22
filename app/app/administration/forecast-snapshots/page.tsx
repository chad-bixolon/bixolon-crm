import { formatEasternDateTime } from '@/lib/display-format';
import { MultiCurrencyOnly } from '@/components/currency-control';
import { WeeklySnapshotStatus } from '@/components/weekly-snapshot-status';
import { snapshotAttribution } from '@/lib/snapshot-capture-identity';
import { HelpLink } from '@/components/help-link';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { assertSnapshotAdmin, FORECAST_SNAPSHOT_SCOPE } from '@/lib/opportunity-snapshots';
import { prisma } from '@/lib/prisma';
import { businessQuarter } from '@/lib/business-quarter';
import { ForecastSnapshotWorkflow } from './workflow';
export const dynamic = 'force-dynamic';
export default async function ForecastSnapshotAdministration({ searchParams }: { searchParams: Promise<{ snapshot?: string }> }) {
  const actor = await requirePermission('configuration.manage'); assertSnapshotAdmin(actor);
  const [sources, runs] = await Promise.all([
    prisma.opportunitySnapshotRun.findMany({ where: { scopeVersion: FORECAST_SNAPSHOT_SCOPE, status: 'COMPLETE' }, orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 104 }),
    prisma.forecastSnapshotRun.findMany({ orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 12 }),
  ]);
  const selected = (await searchParams).snapshot;
  const selectedId = selected && /^\d+$/.test(selected) && Number.isSafeInteger(Number(selected)) ? Number(selected) : undefined;
  const requested = selectedId && !runs.some(run => run.id === selectedId) ? await prisma.forecastSnapshotRun.findUnique({ where: { id: selectedId } }) : null;
  if (requested) runs.unshift(requested);
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Forecast Snapshots" description="Create quarterly forecast history from Opportunity Snapshots. Forecast Movement uses separate captures." action={<Link className="btn-secondary" href="/reports/forecast-snapshots">Forecast Snapshot History</Link>}/><div className="mb-4"><HelpLink topic="forecast-snapshots">Help with Forecast Snapshots</HelpLink></div>
    <p className="panel mb-5 p-5 text-sm">Choose an Opportunity capture and a quarter to preserve forecast totals. Pipeline includes Best Case and Commit<MultiCurrencyOnly>; each currency stays separate</MultiCurrencyOnly>.</p>
    <p className="mb-3 text-xs text-slate-600">Create one forecast snapshot per Opportunity capture and quarter. Weekly automation captures the source’s current quarter when configured; manual capture remains available.</p>
    <p className="mb-5 text-sm">Select an Opportunity Snapshot that includes forecast data. The most recent eligible snapshot runs are shown below. <Link className="underline" href="/administration/opportunity-snapshots">Capture an Opportunity Snapshot</Link></p>
    <WeeklySnapshotStatus actor={actor}/>
    <ForecastSnapshotWorkflow sources={sources.map(source => ({ id: source.id, snapshotAt: source.snapshotAt.toISOString(), opportunityCount: source.opportunityCount }))} initialPeriod={businessQuarter()}/>
    <section className="panel p-5">{selectedId && <p className="mb-3 text-sm text-slate-600">{runs.some(run => run.id === selectedId) ? `Selected snapshot #${selectedId} is included below with recent snapshots.` : "The requested snapshot is not available. Recent snapshots are shown below."}</p>}<h2 className="mb-3 text-lg font-semibold">Recent Forecast Snapshots</h2>{runs.length ? <ul className="divide-y">{runs.map(run => <li id={`snapshot-${run.id}`} key={run.id} className="scroll-mt-5 break-words py-3 text-sm target:bg-orange-50 target:p-3">{formatEasternDateTime(run.snapshotAt)} Eastern · Snapshot #{run.id} · {run.year} {run.quarter} · Opportunity Snapshot #{run.sourceRunId} · {run.opportunityCount} Opportunities · {snapshotAttribution(run)} · {run.status === 'COMPLETE' ? 'Complete' : run.status}<details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">Snapshot details</summary><p>Capture time (UTC): <time dateTime={run.snapshotAt.toISOString()}>{run.snapshotAt.toISOString()}</time></p></details></li>)}</ul> : <p className="text-sm">No forecast snapshots have been created yet.</p>}</section>
  </Content>;
}
