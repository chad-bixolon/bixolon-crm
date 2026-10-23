import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { SupportCaseForm } from '@/components/support-case-form';
import { requirePermission } from '@/lib/current-user';
import { supportFormOptions } from '@/lib/support-case-ui';
import { formatDateTimeForUser } from '@/lib/display-format';
import { prisma } from '@/lib/prisma';
import { emailIntakeContext } from '@/lib/support-email-source';
import { emailFileOptions } from '@/lib/support-email-file-import';
import { existingEmailCase } from '@/lib/support-email';
export const dynamic = 'force-dynamic';
export default async function NewSupportCasePage({ searchParams }: { searchParams: Promise<{ emailMessageId?: string }> }) {
  const actor = await requirePermission('support-cases.write');
  const { emailMessageId } = await searchParams;
  const options = await supportFormOptions(actor);
  let context;
  if (emailMessageId !== undefined) {
    try { context = await emailIntakeContext(prisma, actor, emailMessageId); }
    catch { return <Content><PageHeader eyebrow={NAV_CATEGORIES.support} title="New Support Case"/><p role="alert" className="panel p-5">Email source is unavailable or invalid. Return to the Support Inbox and try again.</p><Link href="/support/inbox" className="btn-secondary mt-4">Back to Inbox</Link></Content>; }
    let existingId;
    try { existingId = await existingEmailCase(prisma, context.message); }
    catch { return <Content><p role="alert" className="panel p-5">This email thread has conflicting Case links. Review it in the Support Inbox.</p><Link href="/support/inbox" className="btn-secondary">Back to Inbox</Link></Content>; }
    if (existingId) redirect(`/support/cases/${existingId}?emailIntake=already-linked`);
  }
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.support} title="New Support Case" description={context ? 'Create a Case from Support email.' : 'Record a customer issue.'}/>
    {context && <section aria-label="Support email source" className="panel mb-5 space-y-2 p-5 text-sm break-words"><h2 className="font-semibold">From Support email</h2><p><strong>From:</strong> {context.firstMessage.senderName} &lt;{context.firstMessage.senderEmail}&gt;</p><p><strong>Subject:</strong> {context.message.subject}</p><p><strong>Received:</strong> {formatDateTimeForUser(context.message.messageDate, options.zone)}</p><p><strong>Matched Account:</strong> {context.account?.name ?? 'None — select manually if needed'}</p><p><strong>Matched Contact:</strong> {context.contact ? `${context.contact.firstName} ${context.contact.lastName}` : 'None — select manually if needed'}</p><p className="text-slate-600">Saving creates the Case and links the source email together in CRM. Gmail stays read-only. Description starts with the earliest available email request in this recent thread; CRM notes can be added after creation.</p></section>}
    <SupportCaseForm {...options} emailPrefill={context?.prefill} emailSource={context?.token} emailFiles={context ? emailFileOptions(actor, context.token, context.messages) : undefined}/></Content>;
}
