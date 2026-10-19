import { formatEasternDateTime } from '@/lib/display-format';
import { WeeklySnapshotStatus } from '@/components/weekly-snapshot-status';
import { snapshotAttribution } from '@/lib/snapshot-capture-identity';
import { HelpLink } from '@/components/help-link';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { assertSnapshotAdmin } from '@/lib/opportunity-snapshots';
import { prisma } from '@/lib/prisma';
import { SnapshotWorkflow } from './workflow';

export const dynamic = 'force-dynamic';
export default async function SnapshotAdministrationPage({ searchParams }: { searchParams: Promise<{ snapshot?: string }> }) {
  const actor = await requirePermission('users.manage');
  assertSnapshotAdmin(actor);
  const runs = await prisma.opportunitySnapshotRun.findMany({ orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 12 });
  const selected = (await searchParams).snapshot;
  const selectedId = selected && /^\d+$/.test(selected) && Number.isSafeInteger(Number(selected)) ? Number(selected) : undefined;
  const requested = selectedId && !runs.some(run => run.id === selectedId) ? await prisma.opportunitySnapshotRun.findUnique({ where: { id: selectedId } }) : null;
  if (requested) runs.unshift(requested);
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Opportunity Snapshots" description="Capture and compare weekly Opportunity history." action={<Link className="btn-secondary" href="/reports/opportunity-snapshots">Snapshot History</Link>}/><div className="mb-4"><HelpLink topic="opportunity-snapshots">Help with Opportunity Snapshots</HelpLink></div>
    <p className="panel mb-5 p-5 text-sm">Capture the open pipeline, or select “Include forecast data” to also include Closed Won deals for Forecast Snapshots. Review the preview carefully: only one capture is available each week.</p>
    <WeeklySnapshotStatus actor={actor}/>
    <SnapshotWorkflow/>
    <section className="panel p-5">{selectedId && <p className="mb-3 text-sm text-slate-600">{runs.some(run => run.id === selectedId) ? `Selected snapshot #${selectedId} is included below with recent snapshots.` : "The requested snapshot is not available. Recent snapshots are shown below."}</p>}<h2 className="mb-3 text-lg font-semibold">Recent Opportunity Snapshots</h2>{runs.length ? <ul className="divide-y">{runs.map(run => <li className="scroll-mt-5 break-words py-3 text-sm target:bg-orange-50 target:p-3" id={`snapshot-${run.id}`} key={run.id}>{formatEasternDateTime(run.snapshotAt)} Eastern · Snapshot #{run.id} · {run.opportunityCount} Opportunities · {snapshotAttribution(run)} · {run.status === 'COMPLETE' ? 'Complete' : run.status}<details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">Snapshot details</summary><p>Capture time (UTC): <time dateTime={run.snapshotAt.toISOString()}>{run.snapshotAt.toISOString()}</time></p></details></li>)}</ul> : <p className="text-sm text-slate-500">No Opportunity snapshots have been captured yet.</p>}</section>
  </Content>;
}
