import { RecentView } from '@/components/recent-view';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { SupportArchiveControl } from '@/components/support-archive-control';
import { SupportCaseTimeline } from '@/components/support-case-timeline';
import { SupportCaseHistory } from '@/components/support-case-history';
import { SupportAttachments } from '@/components/support-attachments';
import { can } from '@/lib/authorization';
import { requirePermission } from '@/lib/current-user';
import { formatDateTimeForUser } from '@/lib/display-format';
import { prisma } from '@/lib/prisma';
import { supportAge } from '@/lib/support-case-display';
import { supportUserZone } from '@/lib/support-case-ui';
import { getSupportCaseById, supportPriorityLabels, supportSourceLabels, supportStatusLabels } from '@/lib/support-cases';
import { caseHistoryView } from '@/lib/support-case-timeline';
import { canCreateCaseWork, canEditCaseTask } from '@/lib/support-work';
import { taskEditWhere } from '@/lib/task-policy';
import { emailFileRecovery } from '@/lib/support-email-file-import';
import { supportGmailEnabled } from '@/lib/support-gmail';
import { SupportOutboundEmailForm } from '@/components/support-outbound-email-form';
import { canLogSupportEmail, supportOutboundEmailContext } from '@/lib/support-outbound-email';
export const dynamic = 'force-dynamic';
export default async function SupportCaseDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ emailIntake?: string; emailFiles?: string }> }) {
  const actor = await requirePermission('support-cases.read'); const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [row, zone] = await Promise.all([getSupportCaseById(prisma, actor, id, true), supportUserZone(actor)]);
  if (!row) notFound();
  const history = await caseHistoryView(prisma, id, row.createdAt, zone, supportGmailEnabled());
  const attachments = await prisma.supportCaseAttachment.findMany({ where: { supportCaseId: id, deletedAt: null }, include: { uploadedBy: { select: { firstName: true, lastName: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const allowNewWork = !row.archivedAt && row.status !== 'CLOSED' && canCreateCaseWork(actor);
  const emailContext = allowNewWork && canLogSupportEmail(actor) ? await supportOutboundEmailContext(prisma, actor, id) : null;
  const tasks = await prisma.task.findMany({ where: { supportCaseId: id, archivedAt: null }, orderBy: [{ dueDate: 'asc' }, { id: 'desc' }], take: 40 });
  const editableTasks = !row.archivedAt && row.status !== 'CLOSED' && can(actor, 'tasks.write') && tasks.length
    ? await prisma.task.findMany({ where: { AND: [{ id: { in: tasks.map(task => task.id) } }, taskEditWhere(actor)] }, select: { id: true } })
    : [];
  const editableTaskIds = new Set(editableTasks.map(task => task.id));
  const workActions = <><Link className="btn-secondary" href={`/activities/new?supportCaseId=${id}`}>Log Activity</Link><Link className="btn-secondary" href={`/tasks/new?supportCaseId=${id}`}>Create Task</Link><Link className="btn-secondary" href={`/notes/new?supportCaseId=${id}`}>Add Note</Link></>;
  const date = (value: Date | null) => value ? formatDateTimeForUser(value, zone) : '—';
  const overdue = !!row.nextFollowUpAt && row.nextFollowUpAt < new Date() && !['RESOLVED','CLOSED'].includes(row.status);
  const fields = [
    ['Status', supportStatusLabels[row.status]], ['Priority', supportPriorityLabels[row.priority]], ['Assigned To', row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : 'Unassigned'],
    ['Customer / End User', row.customerNameText ?? row.account?.name ?? '—'], ['Linked CRM Account', row.account?.name ?? '—'], ['Contact', row.contact ? `${row.contact.firstName} ${row.contact.lastName}` : '—'], ['Category', row.category?.name ?? '—'], ['Product / SKU', row.productSku?.partNumber ?? '—'], ['Serial Number', row.serialNumber ?? '—'], ['Source', supportSourceLabels[row.source]], ...(row.purchaseSourceText ? [['Purchased From', row.purchaseSourceText]] : []), ...(row.purchasedFromAccount ? [['Linked Purchased-From Account', row.purchasedFromAccount.name]] : []), ...(!row.purchaseSourceText && !row.purchasedFromAccount ? [['Purchased From', '—']] : []), ['Opened', date(row.openedAt)], ['Next Follow-up', date(row.nextFollowUpAt)], ['Resolved', date(row.resolvedAt)], ['Closed', date(row.closedAt)], ['Age', supportAge(row.openedAt, row.status, row.resolvedAt, row.closedAt)]
  ];
  const emailFailures = supportGmailEnabled() ? await emailFileRecovery(prisma, id) : [];
  const hasEmails = supportGmailEnabled() && !!await prisma.supportCaseEmail.findFirst({ where: { supportCaseId: id }, select: { id: true } });
  const fileStatus = (await searchParams).emailFiles;
  const alreadyLinked = (await searchParams).emailIntake === 'already-linked';
  return <Content><RecentView entityType="SUPPORT_CASE" recordId={id}/>{alreadyLinked && <p role="status" className="panel mb-4 p-4">This email thread is already linked to this Case. No additional Case was created.</p>}<PageHeader eyebrow={NAV_CATEGORIES.support} title={`${row.caseNumber} · ${row.subject}`} description={row.archivedAt ? 'Archived Support Case' : undefined} action={<div className="page-header-actions"><Link className="btn-secondary" href="/support/cases">All cases</Link>{can(actor, 'support-cases.write') && <>{!row.archivedAt && <Link className="btn-primary" href={`/support/cases/${id}/edit`}>Edit</Link>}{can(actor, 'support-oversight.manage') && <SupportArchiveControl id={id} archived={!!row.archivedAt}/>}</>}</div>}/>
    {allowNewWork && (emailContext ? <SupportOutboundEmailForm caseId={id} context={emailContext.prefill} userName={actor.name} zone={zone}>{workActions}</SupportOutboundEmailForm> : <div className="mb-5 flex flex-wrap gap-2">{workActions}</div>)}
    <section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Case summary</h2><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className={`mt-1 break-words text-sm ${label === 'Priority' && row.priority === 'CRITICAL' ? 'font-semibold text-red-800' : ''}`}>{label === 'Linked CRM Account' && row.accountId ? <Link className="text-orange-800 hover:underline" href={`/accounts/${row.accountId}`}>{value}</Link> : label === 'Linked Purchased-From Account' && row.purchasedFromAccountId ? <Link className="text-orange-800 hover:underline" href={`/accounts/${row.purchasedFromAccountId}`}>{value}</Link> : label === 'Contact' && row.contactId ? <Link className="text-orange-800 hover:underline" href={`/contacts/${row.contactId}`}>{value}</Link> : label === 'Product / SKU' && row.productSku ? <Link className="text-orange-800 hover:underline" href={`/products/${row.productSku.productId}`}>{value}</Link> : label === 'Next Follow-up' && overdue ? <>{value} <strong className="text-red-800">· Overdue</strong></> : value}</dd></div>)}</dl></section>
    <section className="panel mb-5 p-5"><h2 className="mb-3 text-lg font-semibold">Description</h2><p className="whitespace-pre-wrap break-words text-sm leading-6">{row.description}</p></section>
    {(row.resolutionSummary || ['RESOLVED','CLOSED'].includes(row.status)) && <section className="panel mb-5 p-5"><h2 className="mb-3 text-lg font-semibold">Resolution Summary</h2><p className="whitespace-pre-wrap break-words text-sm">{row.resolutionSummary || 'No summary recorded.'}</p></section>}
    {!!emailFailures.length && <section aria-label="Email file import issues" className="panel mb-5 p-4"><h2 className="font-semibold">Some email files were not imported</h2><p className="mt-1 text-sm">This Case and its originating email link are saved. Successfully copied files appear in Attachments.</p><ul className="mt-2 text-sm">{emailFailures.map(file => <li key={`${file.messageId}:${file.partId}`} className="break-words">{file.name}: {file.reason}</li>)}</ul></section>}
    {fileStatus === 'partial' && !emailFailures.length && <p role="status" className="panel mb-5 p-4">Case and email link are saved. Review attachments if an optional file was not copied.</p>}
    {fileStatus === 'complete' && <p role="status" className="panel mb-5 p-4">Selected email files were imported or already present.</p>}
    {hasEmails && can(actor, 'support-cases.write') && !row.archivedAt && row.status !== 'CLOSED' && <div className="mb-4"><Link className="btn-secondary" href={`/support/cases/${id}/email-attachments`}>{emailFailures.length ? 'Review / retry email attachments' : 'Import files from linked email'}</Link></div>}
    <SupportAttachments caseId={id} items={attachments} canWrite={can(actor, 'support-cases.write') && !row.archivedAt && row.status !== 'CLOSED'} zone={zone}/>
    <section className="panel mb-5 p-4 sm:p-5" aria-label="Case Tasks"><h2 className="mb-3 text-lg font-semibold">Case Tasks</h2>{tasks.length ? <ul className="divide-y">{tasks.map(task => <li key={task.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0 break-words"><Link className="font-medium text-orange-800 underline" href={`/tasks/${task.id}`}>{task.subject}</Link><p className="mt-1 text-slate-600">{task.status.replaceAll('_', ' ')} · {task.dueDate ? `Due ${task.dueDate.toISOString().slice(0, 10)}` : 'No due date'}</p></div>{!row.archivedAt && row.status !== 'CLOSED' && (editableTaskIds.has(task.id) || (!can(actor, 'tasks.write') && canEditCaseTask(actor, task))) && <Link className="btn-secondary" href={`/tasks/${task.id}/edit`}>Edit / complete task</Link>}</li>)}</ul> : <p className="text-sm text-slate-500">No Tasks linked to this Case.</p>}{tasks.length === 40 && <p className="mt-3 text-xs text-slate-500">Showing up to 40 Case Tasks.</p>}</section>
    <SupportCaseTimeline items={history.timeline} zone={zone} caseId={id}/>
    <SupportCaseHistory events={history.auditEvents} caseCreatedAt={row.createdAt} viewerId={actor.id} zone={zone} caseId={id} truncated={history.auditTruncated}/>
  </Content>;
}
