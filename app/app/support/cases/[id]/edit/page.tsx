import { notFound } from 'next/navigation';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { SupportCaseForm } from '@/components/support-case-form';
import { requirePermission } from '@/lib/current-user';
import { getSupportCaseById } from '@/lib/support-cases';
import { supportFormOptions } from '@/lib/support-case-ui';
import { calendarLocalInput } from '@/lib/calendar-time';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export default async function EditSupportCasePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('support-cases.write'); const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [row, options] = await Promise.all([getSupportCaseById(prisma, actor, id, true), supportFormOptions(actor)]);
  if (!row || row.archivedAt) notFound();
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.support} title={`Edit ${row.caseNumber}`} description={row.subject}/><SupportCaseForm {...options} initial={{ ...row, nextFollowUpAt: row.nextFollowUpAt ? calendarLocalInput(row.nextFollowUpAt, options.zone) : null }}/></Content>;
}
