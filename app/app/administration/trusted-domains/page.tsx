import Link from 'next/link';
import { auth } from '@/auth';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { emailDomain, getTrustedDomains } from '@/lib/trusted-domains';
import { AddDomainForm, DomainActionForm } from './domain-forms';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';

export const dynamic = 'force-dynamic';
export default async function TrustedDomainsPage() {
  await requirePermission('deployment.manage');
  const [rows, persistedCount, session] = await Promise.all([getTrustedDomains(prisma), prisma.trustedSignInDomain.count(), auth()]);
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Trusted Sign-In Domains" description="Choose which corporate Google domains may sign in." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><p className="mb-4 max-w-3xl text-sm text-slate-600">A trusted domain does not create an account or set a role. Each person still needs an active, approved user account. At least one domain must stay active.</p><div className="panel max-w-3xl divide-y">{rows.map(row => <div key={row.domain} className="flex flex-wrap items-start justify-between gap-3 p-4"><div className="min-w-0 break-all font-medium">{row.domain}<span className={`ml-2 text-xs ${row.active ? 'text-green-700' : 'text-slate-500'}`}>{row.active ? 'Active' : 'Inactive'}</span>{!persistedCount && <p className="mt-1 text-xs text-slate-500">Bootstrap domain from deployment configuration</p>}</div><DomainActionForm domain={row.domain} active={row.active} own={row.domain === session?.googleHostedDomain || row.domain === emailDomain(session?.googleEmail ?? '')}/></div>)}{!rows.length && <p className="p-4 text-sm text-red-700">No trusted sign-in domain is configured. Ask a maintainer to set GOOGLE_WORKSPACE_DOMAIN.</p>}</div><AddDomainForm/></Content>;
}
