import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { SupportArchiveControl } from '@/components/support-archive-control';
import { SupportCaseTimeline } from '@/components/support-case-timeline';
import { SupportCaseHistory } from '@/components/support-case-history';
import { can } from '@/lib/authorization';
import { requirePermission } from '@/lib/current-user';
import { formatDateTimeForUser } from '@/lib/display-format';
import { prisma } from '@/lib/prisma';
import { supportAge } from '@/lib/support-case-display';
import { supportUserZone } from '@/lib/support-case-ui';
import { getSupportCaseById, supportPriorityLabels, supportSourceLabels, supportStatusLabels } from '@/lib/support-cases';
import { caseHistoryView } from '@/lib/support-case-timeline';
import { canCreateCaseWork } from '@/lib/support-work';
export const dynamic = 'force-dynamic';
export default async function SupportCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('support-cases.read'); const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [row, zone] = await Promise.all([getSupportCaseById(prisma, actor, id, true), supportUserZone(actor)]);
  if (!row) notFound();
  const history = await caseHistoryView(prisma, id, row.createdAt, zone);
  if (!can(actor, 'tasks.write')) for (const item of history.timeline) if (item.source === 'Activity') item.href = undefined;
  const allowNewWork = !row.archivedAt && row.status !== 'CLOSED' && canCreateCaseWork(actor);
  const date = (value: Date | null) => value ? formatDateTimeForUser(value, zone) : '—';
  const overdue = !!row.nextFollowUpAt && row.nextFollowUpAt < new Date() && !['RESOLVED','CLOSED'].includes(row.status);
  const fields = [
    ['Status', supportStatusLabels[row.status]], ['Priority', supportPriorityLabels[row.priority]], ['Assigned To', row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : 'Unassigned'],
    ['Customer / End User', row.customerNameText ?? row.account?.name ?? '—'], ['Linked CRM Account', row.account?.name ?? '—'], ['Contact', row.contact ? `${row.contact.firstName} ${row.contact.lastName}` : '—'], ['Category', row.category?.name ?? '—'], ['Product / SKU', row.productSku?.partNumber ?? '—'], ['Serial Number', row.serialNumber ?? '—'], ['Source', supportSourceLabels[row.source]], ...(row.purchaseSourceText ? [['Purchased From', row.purchaseSourceText]] : []), ...(row.purchasedFromAccount ? [['Linked Purchased-From Account', row.purchasedFromAccount.name]] : []), ...(!row.purchaseSourceText && !row.purchasedFromAccount ? [['Purchased From', '—']] : []), ['Opened', date(row.openedAt)], ['Next Follow-up', date(row.nextFollowUpAt)], ['Resolved', date(row.resolvedAt)], ['Closed', date(row.closedAt)], ['Age', supportAge(row.openedAt, row.status, row.resolvedAt, row.closedAt)]
  ];
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.support} title={`${row.caseNumber} · ${row.subject}`} description={row.archivedAt ? 'Archived Support Case' : undefined} action={<div className="page-header-actions"><Link className="btn-secondary" href="/support/cases">All cases</Link>{can(actor, 'support-cases.write') && <>{!row.archivedAt && <Link className="btn-primary" href={`/support/cases/${id}/edit`}>Edit</Link>}<SupportArchiveControl id={id} archived={!!row.archivedAt}/></>}</div>}/>
    {allowNewWork && <div className="mb-5 flex flex-wrap gap-2"><Link className="btn-secondary" href={`/activities/new?supportCaseId=${id}`}>Log Activity</Link><Link className="btn-secondary" href={`/tasks/new?supportCaseId=${id}`}>Create Task</Link><Link className="btn-secondary" href={`/notes/new?supportCaseId=${id}`}>Add Note</Link></div>}
    <section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Case summary</h2><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className={`mt-1 break-words text-sm ${label === 'Priority' && row.priority === 'CRITICAL' ? 'font-semibold text-red-800' : ''}`}>{label === 'Linked CRM Account' && row.accountId ? <Link className="text-orange-800 hover:underline" href={`/accounts/${row.accountId}`}>{value}</Link> : label === 'Linked Purchased-From Account' && row.purchasedFromAccountId ? <Link className="text-orange-800 hover:underline" href={`/accounts/${row.purchasedFromAccountId}`}>{value}</Link> : label === 'Contact' && row.contactId ? <Link className="text-orange-800 hover:underline" href={`/contacts/${row.contactId}`}>{value}</Link> : label === 'Product / SKU' && row.productSku ? <Link className="text-orange-800 hover:underline" href={`/products/${row.productSku.productId}`}>{value}</Link> : label === 'Next Follow-up' && overdue ? <>{value} <strong className="text-red-800">· Overdue</strong></> : value}</dd></div>)}</dl></section>
    <section className="panel mb-5 p-5"><h2 className="mb-3 text-lg font-semibold">Description</h2><p className="whitespace-pre-wrap break-words text-sm leading-6">{row.description}</p></section>
    {(row.resolutionSummary || ['RESOLVED','CLOSED'].includes(row.status)) && <section className="panel mb-5 p-5"><h2 className="mb-3 text-lg font-semibold">Resolution Summary</h2><p className="whitespace-pre-wrap break-words text-sm">{row.resolutionSummary || 'No summary recorded.'}</p></section>}
    <SupportCaseTimeline items={history.timeline} zone={zone} caseId={id}/>
    <SupportCaseHistory events={history.auditEvents} caseCreatedAt={row.createdAt} viewerId={actor.id} zone={zone} caseId={id} truncated={history.auditTruncated}/>
  </Content>;
}
