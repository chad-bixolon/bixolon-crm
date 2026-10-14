import Link from 'next/link';
import { supportStatusLabels } from '@/lib/support-cases';
import type { accountSupportSummary } from '@/lib/related-support-cases';

export function AccountSupportEmails({ emails }: { emails: Awaited<ReturnType<typeof accountSupportSummary>>['emails'] }) {
  return <section className="panel p-6"><h2 className="mb-3 text-lg font-semibold">Linked support emails</h2>{emails.length ? <ul className="divide-y divide-slate-100">{emails.map(email => <li key={email.id} className="py-3 text-sm"><p className="font-medium">{email.subject}</p><p className="text-slate-600">{email.senderEmail} · {email.messageDate.toLocaleString('en-US')} · <Link className="text-orange-800 underline" href={`/support/cases/${email.supportCase.id}`}>{email.supportCase.caseNumber}</Link> · {supportStatusLabels[email.supportCase.status]}</p><p className="mt-1 text-slate-700">{email.bodyText.slice(0, 180)}{email.bodyText.length > 180 ? '…' : ''}</p></li>)}</ul> : <p className="text-sm text-slate-500">No linked emails for this Account.</p>}</section>;
}
