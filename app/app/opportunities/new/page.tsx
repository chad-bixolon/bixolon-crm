import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import { Content, PageHeader } from "@/components/shell";
import { OpportunityForm } from "@/components/opportunity-form";
import { opportunityOptions } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
import { getLabels } from "@/lib/configuration";
import { requirePermission } from "@/lib/current-user";
import { notFound } from "next/navigation";
import { defaultEligibleUserId } from "@/lib/assignment-eligibility";
export const dynamic = "force-dynamic";
export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<{ accountId?: string | string[] }> }) {
  const actor = await requirePermission('sales.write');
  const [options, labels, params] = await Promise.all([opportunityOptions(prisma), getLabels(prisma), searchParams]);
  const rawAccountId = params.accountId;
  const accountContextId = rawAccountId === undefined ? undefined : typeof rawAccountId === 'string' && /^[1-9]\d*$/.test(rawAccountId) ? Number(rawAccountId) : NaN;
  if (accountContextId !== undefined) {
    if (!Number.isSafeInteger(accountContextId)) notFound();
    options.accounts.push(...await prisma.account.findMany({ where: { id: accountContextId, status: 'ACTIVE', archivedAt: null }, select: { id: true, name: true } }));
    if (!options.accounts.length) notFound();
  }
  const owners = actor.role === 'SALES' ? options.owners.filter(owner => owner.id === actor.id) : options.owners;
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.sales} title="New opportunity" description="Use Opportunities for specific commercial pursuits with expected revenue and close timing."/><OpportunityForm key={accountContextId ? `new-account-${accountContextId}` : "new"} userId={actor.id} accountContextId={accountContextId} {...options} owners={owners} defaultOwnerId={defaultEligibleUserId(owners, actor.id) ?? undefined} labels={labels}/></Content>;
}
