import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { WorkForm, ReactivateTask } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const row = await prisma.task.findUnique({ where: { id }, include: { account: true, opportunity: true, assignedTo: true } });
  if (!row) notFound();

  if (row.archivedAt) {
    const details = [
      ['Status', row.status.replace('_', ' ')],
      ['Priority', row.priority],
      ['Assignee', row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : 'Unassigned'],
      ['Due date', row.dueDate?.toISOString().slice(0, 10) ?? 'None'],
      ['Archived on', row.archivedAt.toISOString().slice(0, 10)],
    ];
    return <Content><PageHeader title={row.subject} eyebrow="Tasks" action={<Link className="btn-secondary" href="/tasks?visibility=archived">Archived tasks</Link>}/>
      <div className="panel space-y-5 p-6">
        <span className="inline-block rounded bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">Archived</span>
        {row.description && <p className="whitespace-pre-wrap text-sm">{row.description}</p>}
        <dl className="grid gap-4 sm:grid-cols-2">{details.map(([label, value]) => <div key={label}><dt className="label">{label}</dt><dd className="text-sm">{value}</dd></div>)}
          <div><dt className="label">Account</dt><dd className="text-sm">{row.account ? <Link className="text-orange-800" href={`/accounts/${row.accountId}`}>{row.account.name}</Link> : 'None'}</dd></div>
          <div><dt className="label">Opportunity</dt><dd className="text-sm">{row.opportunity ? <Link className="text-orange-800" href={`/opportunities/${row.opportunityId}`}>{row.opportunity.name}</Link> : 'None'}</dd></div>
        </dl>
        <ReactivateTask id={id}/>
      </div>
    </Content>;
  }

  const options = await workOptions();
  return <Content><PageHeader title={`Edit task: ${row.subject}`} eyebrow="Tasks"/><WorkForm kind="task" id={id} {...options} initial={{ subject: row.subject, description: row.description, accountId: row.accountId, opportunityId: row.opportunityId, assignedToId: row.assignedToId, status: row.status, priority: row.priority, dueDate: row.dueDate?.toISOString().slice(0, 10) ?? '' }}/></Content>;
}
