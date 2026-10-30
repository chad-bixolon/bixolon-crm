import { isCaseOnlyWorker } from '../../../lib/authorization';
import { RecentView } from '@/components/recent-view';
import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { taskTiming } from '@/lib/work';
import { currentUser } from '@/lib/current-user';
import { assertTaskRead, canEditCaseTask } from '@/lib/support-work';
import { assertTaskEdit } from '@/lib/task-policy';
import { can } from '@/lib/authorization';
import { SaveSuccess } from '@/components/save-success';
import { saveFeedbackMessage } from '@/lib/save-feedback';
import { getModuleAvailability } from '@/lib/module-availability';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [task, query, actor] = await Promise.all([
    prisma.task.findUnique({ where: { id }, include: { account: true, contact: true, supportCase: true, partnerHandoff: { select: { id: true, tradeShowId: true, partnerAccountId: true } }, tradeShowLead: { include: { tradeShow: true } }, opportunity: true, project: true, assignedTo: true } }),
    searchParams,
    currentUser(),
  ]);
  if (!task) notFound();
  const modules = await getModuleAvailability();
  try { await assertTaskRead(prisma, actor, task); } catch { notFound(); }
  let generalEdit = false;
  if (can(actor, 'tasks.write')) { try { await assertTaskEdit(prisma, actor, id); generalEdit = true; } catch { /* Read visibility remains shared. */ } }
  const allowEdit = generalEdit || (!can(actor, 'tasks.write') && canEditCaseTask(actor, task) && !!task.supportCase && !task.supportCase.archivedAt && task.supportCase.status !== 'CLOSED');
  // Older handoff Tasks stored the queue URL as a description line.
  const handoff = task.partnerHandoff;
  const description = handoff
    ? task.description?.split('\n').filter(line => line !== `/trade-shows/${handoff.tradeShowId}/partner-handoffs?partner=${handoff.partnerAccountId}`).join('\n')
    : task.description;
  const details = [
    ['Status', task.status.replace('_', ' ')],
    ['Priority', task.priority],
    ['Assignee', task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'],
    ['Due date', task.dueDate?.toISOString().slice(0, 10) ?? 'None'],
  ];
  return <Content><RecentView entityType="TASK" recordId={id}/>
    <PageHeader eyebrow={task.supportCaseId && isCaseOnlyWorker(actor) && modules.effective.has('SUPPORT_CASES') ? NAV_CATEGORIES.support : NAV_CATEGORIES.sales} title={task.subject} action={<div className="page-header-actions"><Link className="btn-secondary" href={task.supportCaseId && isCaseOnlyWorker(actor) && modules.effective.has('SUPPORT_CASES') ? `/support/cases/${task.supportCaseId}` : '/tasks'}>{task.supportCaseId && isCaseOnlyWorker(actor) && modules.effective.has('SUPPORT_CASES') ? 'Back to case' : 'All tasks'}</Link>{allowEdit && <Link className="btn-primary" href={`/tasks/${id}/edit`}>{isCaseOnlyWorker(actor) ? 'Edit / complete task' : 'Edit task'}</Link>}</div>}/>
    {saveFeedbackMessage(query.saved, 'Task') && <SaveSuccess message={saveFeedbackMessage(query.saved, 'Task')!}/>}
    <section className="panel space-y-5 p-6">
      {task.archivedAt && <span className="inline-block rounded bg-slate-100 px-3 py-1 text-sm font-semibold">Archived</span>}
      {taskTiming(task) && !task.archivedAt && <p className="text-sm font-semibold text-red-700">{taskTiming(task)}</p>}
      {description && <p className="whitespace-pre-wrap text-sm">{description}</p>}
      {task.partnerHandoff && modules.effective.has('TRADE_SHOWS') && can(actor, 'trade-shows.read') && <p><Link className="text-sm text-orange-800 underline" href={`/trade-shows/${task.partnerHandoff.tradeShowId}/partner-handoffs/${task.partnerHandoff.id}`}>View Partner Handoff</Link></p>}
      <dl className="grid gap-4 sm:grid-cols-2">{details.map(([label, value]) => <div key={label}><dt className="label">{label}</dt><dd className="text-sm">{value}</dd></div>)}
        <div><dt className="label">Account</dt><dd className="text-sm">{task.account ? <Link className="text-orange-800" href={`/accounts/${task.accountId}`}>{task.account.name}</Link> : 'None'}</dd></div>
        {task.supportCase && modules.effective.has('SUPPORT_CASES') && <div><dt className="label">Support Case</dt><dd className="text-sm"><Link className="text-orange-800" href={`/support/cases/${task.supportCaseId}`}>{task.supportCase.caseNumber}</Link></dd></div>}
        {!isCaseOnlyWorker(actor) && modules.effective.has('OPPORTUNITIES') && <div><dt className="label">Opportunity</dt><dd className="text-sm">{task.opportunity ? <Link className="text-orange-800" href={`/opportunities/${task.opportunityId}`}>{task.opportunity.name}</Link> : 'None'}</dd></div>}
        {!isCaseOnlyWorker(actor) && modules.effective.has('PROJECTS') && <div><dt className="label">Project</dt><dd className="text-sm">{task.project ? <Link className="text-orange-800" href={`/projects/${task.projectId}`}>{task.project.name}</Link> : 'None'}</dd></div>}
        {task.contact && <div><dt className="label">Contact</dt><dd className="text-sm"><Link className="text-orange-800" href={`/contacts/${task.contactId}`}>{task.contact.firstName} {task.contact.lastName}</Link>{task.contact.archivedAt ? <span className="ml-2 text-xs text-slate-500">Archived</span> : !task.contact.active && <span className="ml-2 text-xs text-slate-500">Inactive</span>}</dd></div>}
        {task.tradeShowLead && modules.effective.has('TRADE_SHOWS') && <div><dt className="label">Trade Show Lead</dt><dd className="text-sm"><Link className="text-orange-800" href={`/trade-shows/${task.tradeShowLead.tradeShowId}/leads/${task.tradeShowLeadId}`}>{task.tradeShowLead.firstName} {task.tradeShowLead.lastName} · {task.tradeShowLead.tradeShow.name}</Link></dd></div>}
      </dl>
    </section>
  </Content>;
}
