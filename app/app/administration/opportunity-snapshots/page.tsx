import { HelpLink } from '@/components/help-link';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { assertSnapshotAdmin } from '@/lib/opportunity-snapshots';
import { prisma } from '@/lib/prisma';
import { SnapshotWorkflow } from './workflow';

export const dynamic = 'force-dynamic';
export default async function SnapshotAdministrationPage() {
  const actor = await requirePermission('users.manage');
  assertSnapshotAdmin(actor);
  const runs = await prisma.opportunitySnapshotRun.findMany({ orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 12 });
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Opportunity Snapshots" description="Capture and compare weekly Opportunity history." action={<Link className="btn-secondary" href="/reports/opportunity-snapshots">Snapshot History</Link>}/><div className="mb-4"><HelpLink topic="opportunity-snapshots">Help with Opportunity Snapshots</HelpLink></div>
    <p className="panel mb-5 p-5 text-sm">Capture the open pipeline, or select “Include forecast data” to also include Closed Won deals for Forecast Snapshots. Review the preview carefully: only one capture is available each week.</p>
    <SnapshotWorkflow/>
    <section className="panel p-5"><h2 className="mb-3 text-lg font-semibold">Recent Opportunity Snapshots</h2>{runs.length ? <ul className="divide-y">{runs.map(run => <li className="break-words py-3 text-sm" key={run.id}>Snapshot #{run.id} · {run.snapshotAt.toISOString()} · {run.opportunityCount} Opportunities · {run.createdByName} · {run.status}</li>)}</ul> : <p className="text-sm text-slate-500">No Opportunity snapshots have been captured yet.</p>}</section>
  </Content>;
}
