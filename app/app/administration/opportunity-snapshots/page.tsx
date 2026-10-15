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
  return <Content><PageHeader eyebrow="Administration" title="Opportunity Snapshots" description="Preserve weekly point-in-time Opportunity state for historical reporting." action={<Link className="btn-secondary" href="/reports/opportunity-snapshots">Snapshot History</Link>}/>
    <p className="panel mb-5 p-5 text-sm">Includes open, unarchived Opportunities whose linked Accounts and Projects satisfy the existing operational visibility rules. Includes omitted forecast categories, unassigned owners, and missing close dates. The default scope excludes closed Opportunities. Forecast-ready scope additionally captures Closed Won and owner eligibility for source-linked forecast rollups. Archived Opportunities are excluded. Archive known test records before capture; SalesHub has no test-data flag.</p>
    <SnapshotWorkflow/>
    <section className="panel p-5"><h2 className="mb-3 text-lg font-semibold">Recent runs</h2>{runs.length ? <ul className="divide-y">{runs.map(run => <li className="break-words py-3 text-sm" key={run.id}>Run #{run.id} · {run.snapshotAt.toISOString()} · {run.opportunityCount} Opportunities · {run.createdByName} · {run.status}</li>)}</ul> : <p className="text-sm text-slate-500">No Opportunity snapshot runs yet.</p>}</section>
  </Content>;
}
