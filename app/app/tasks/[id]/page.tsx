import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { taskTiming } from '@/lib/work';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [task, query, actor] = await Promise.all([
    prisma.task.findUnique({ where: { id }, include: { account: true, opportunity: true, project: true, assignedTo: true } }),
    searchParams,
    currentUser(),
  ]);
  if (!task) notFound();
  const details = [
    ['Status', task.status.replace('_', ' ')],
    ['Priority', task.priority],
    ['Assignee', task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'],
    ['Due date', task.dueDate?.toISOString().slice(0, 10) ?? 'None'],
  ];
  return <Content>
    <PageHeader eyebrow="Tasks" title={task.subject} action={<div className="flex gap-2"><Link className="btn-secondary" href="/tasks">All tasks</Link>{can(actor, 'tasks.write') && <Link className="btn-primary" href={`/tasks/${id}/edit`}>Edit task</Link>}</div>}/>
    {query.created === '1' && <p role="status" className="mb-5 rounded border border-green-300 bg-green-50 p-4 text-sm font-semibold text-green-900">Task created successfully.</p>}
    <section className="panel space-y-5 p-6">
      {task.archivedAt && <span className="inline-block rounded bg-slate-100 px-3 py-1 text-sm font-semibold">Archived</span>}
      {taskTiming(task) && !task.archivedAt && <p className="text-sm font-semibold text-red-700">{taskTiming(task)}</p>}
      {task.description && <p className="whitespace-pre-wrap text-sm">{task.description}</p>}
      <dl className="grid gap-4 sm:grid-cols-2">{details.map(([label, value]) => <div key={label}><dt className="label">{label}</dt><dd className="text-sm">{value}</dd></div>)}
        <div><dt className="label">Account</dt><dd className="text-sm">{task.account ? <Link className="text-orange-800" href={`/accounts/${task.accountId}`}>{task.account.name}</Link> : 'None'}</dd></div>
        <div><dt className="label">Opportunity</dt><dd className="text-sm">{task.opportunity ? <Link className="text-orange-800" href={`/opportunities/${task.opportunityId}`}>{task.opportunity.name}</Link> : 'None'}</dd></div>
        <div><dt className="label">Project</dt><dd className="text-sm">{task.project ? <Link className="text-orange-800" href={`/projects/${task.projectId}`}>{task.project.name}</Link> : 'None'}</dd></div>
      </dl>
    </section>
  </Content>;
}
