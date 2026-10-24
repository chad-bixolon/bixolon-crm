import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { getInternalDomainRows } from '@/lib/internal-email-domains';
import { AddInternalDomainForm, InternalDomainActionForm } from './domain-forms';
import { HelpLink } from '@/components/help-link';

export const dynamic = 'force-dynamic';
export default async function InternalEmailDomainsPage() {
  await requirePermission('deployment.manage');
  const { rows, persisted } = await getInternalDomainRows(prisma);
  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.administration} title="Internal Email Domains" description="Identify your own organization's email addresses." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/>
    <div className="mb-4"><HelpLink topic="internal-email-domains">Help with Internal Email Domains</HelpLink></div>
    <div className="mb-4 max-w-3xl space-y-3 text-sm text-slate-700">
      <p>Internal Email Domains tell SalesHub which email addresses belong to your own company. SalesHub uses them to distinguish coworkers from customers, partners, and other external contacts in Calendar, My Day, and Support.</p>
      <p className="font-medium">Internal Email Domains do not control who can sign in to SalesHub. Sign-in access is managed separately under <Link className="text-orange-800 underline" href="/administration/trusted-domains">Trusted Sign-In Domains</Link>.</p>
      <p>Enter an email domain such as acme.com. Only that exact domain matches; eu.acme.com would need its own entry.</p>
      {!persisted && rows.length > 0 && <p className="rounded border border-amber-200 bg-amber-50 p-3">These suggested domains come from current deployment and sign-in settings. Your first change saves this list so future sign-in setting changes cannot alter it.</p>}
      {!rows.some(row => row.active) && <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3">No Internal Email Domains are active. SalesHub will treat all email domains as external for email and calendar classification. Calendar still recognizes the meeting owner and self attendee.</p>}
    </div>
    <div className="panel max-w-3xl divide-y">{rows.map(row => <div key={row.domain} className="flex flex-wrap items-start justify-between gap-3 p-4"><div className="min-w-0 break-all font-medium">{row.domain}<span className={`ml-2 text-xs ${row.active ? 'text-green-700' : 'text-slate-500'}`}>{row.active ? 'Active' : 'Inactive'}</span>{!persisted && <p className="mt-1 text-xs text-slate-500">Suggested bootstrap domain</p>}</div><InternalDomainActionForm domain={row.domain} active={row.active}/></div>)}{!rows.length && <p className="p-4 text-sm text-slate-600">No domains are listed yet. Add an email domain used by your company below.</p>}</div>
    <AddInternalDomainForm/>
  </Content>;
}
