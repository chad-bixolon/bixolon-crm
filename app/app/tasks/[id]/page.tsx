import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { taskTiming } from '@/lib/work';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { SaveSuccess } from '@/components/save-success';
import { saveFeedbackMessage } from '@/lib/save-feedback';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [task, query, actor] = await Promise.all([
    prisma.task.findUnique({ where: { id }, include: { account: true, contact: true, supportCase: true, tradeShowLead: { include: { tradeShow: true } }, opportunity: true, project: true, assignedTo: true } }),
    searchParams,
    currentUser(),
  ]);
  if (!task) notFound();
  if (actor.role === 'SUPPORT' && !task.supportCaseId) notFound();
  const details = [
    ['Status', task.status.replace('_', ' ')],
    ['Priority', task.priority],
    ['Assignee', task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'],
    ['Due date', task.dueDate?.toISOString().slice(0, 10) ?? 'None'],
  ];
  return <Content>
    <PageHeader eyebrow={task.supportCaseId && actor.role === 'SUPPORT' ? NAV_CATEGORIES.support : NAV_CATEGORIES.sales} title={task.subject} action={<div className="page-header-actions"><Link className="btn-secondary" href={task.supportCaseId && actor.role === 'SUPPORT' ? `/support/cases/${task.supportCaseId}` : '/tasks'}>{task.supportCaseId && actor.role === 'SUPPORT' ? 'Back to case' : 'All tasks'}</Link>{can(actor, 'tasks.write') && <Link className="btn-primary" href={`/tasks/${id}/edit`}>Edit task</Link>}</div>}/>
    {saveFeedbackMessage(query.saved, 'Task') && <SaveSuccess message={saveFeedbackMessage(query.saved, 'Task')!}/>}
    <section className="panel space-y-5 p-6">
      {task.archivedAt && <span className="inline-block rounded bg-slate-100 px-3 py-1 text-sm font-semibold">Archived</span>}
      {taskTiming(task) && !task.archivedAt && <p className="text-sm font-semibold text-red-700">{taskTiming(task)}</p>}
      {task.description && <p className="whitespace-pre-wrap text-sm">{task.description}</p>}
      <dl className="grid gap-4 sm:grid-cols-2">{details.map(([label, value]) => <div key={label}><dt className="label">{label}</dt><dd className="text-sm">{value}</dd></div>)}
        <div><dt className="label">Account</dt><dd className="text-sm">{task.account ? <Link className="text-orange-800" href={`/accounts/${task.accountId}`}>{task.account.name}</Link> : 'None'}</dd></div>
        {task.supportCase && <div><dt className="label">Support Case</dt><dd className="text-sm"><Link className="text-orange-800" href={`/support/cases/${task.supportCaseId}`}>{task.supportCase.caseNumber}</Link></dd></div>}
        {actor.role !== 'SUPPORT' && <div><dt className="label">Opportunity</dt><dd className="text-sm">{task.opportunity ? <Link className="text-orange-800" href={`/opportunities/${task.opportunityId}`}>{task.opportunity.name}</Link> : 'None'}</dd></div>}
        {actor.role !== 'SUPPORT' && <div><dt className="label">Project</dt><dd className="text-sm">{task.project ? <Link className="text-orange-800" href={`/projects/${task.projectId}`}>{task.project.name}</Link> : 'None'}</dd></div>}
        {task.contact && <div><dt className="label">Contact</dt><dd className="text-sm"><Link className="text-orange-800" href={`/contacts/${task.contactId}`}>{task.contact.firstName} {task.contact.lastName}</Link>{task.contact.archivedAt ? <span className="ml-2 text-xs text-slate-500">Archived</span> : !task.contact.active && <span className="ml-2 text-xs text-slate-500">Inactive</span>}</dd></div>}
        {task.tradeShowLead && <div><dt className="label">Trade Show Lead</dt><dd className="text-sm"><Link className="text-orange-800" href={`/trade-shows/${task.tradeShowLead.tradeShowId}/leads/${task.tradeShowLeadId}`}>{task.tradeShowLead.firstName} {task.tradeShowLead.lastName} · {task.tradeShowLead.tradeShow.name}</Link></dd></div>}
      </dl>
    </section>
  </Content>;
}
