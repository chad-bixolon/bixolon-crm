import { Content, PageHeader } from "@/components/shell";
import { OpportunityForm } from "@/components/opportunity-form";
import { opportunityOptions } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
import { getLabels } from "@/lib/configuration";
import { currentUser } from "@/lib/current-user";
import { notFound } from "next/navigation";
import { defaultEligibleUserId } from "@/lib/assignment-eligibility";
export const dynamic = "force-dynamic";
export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<{ accountId?: string | string[] }> }) {
  const [options, labels, actor, params] = await Promise.all([opportunityOptions(prisma), getLabels(prisma), currentUser(), searchParams]);
  const rawAccountId = params.accountId;
  const accountContextId = rawAccountId === undefined ? undefined : typeof rawAccountId === 'string' && /^[1-9]\d*$/.test(rawAccountId) ? Number(rawAccountId) : NaN;
  if (accountContextId !== undefined && (!Number.isSafeInteger(accountContextId) || !options.accounts.some(account => account.id === accountContextId))) notFound();
  const owners = actor.role === 'SALES' ? options.owners.filter(owner => owner.id === actor.id) : options.owners;
  return <Content><PageHeader eyebrow="Opportunities" title="New opportunity" description="Use Opportunities for specific commercial pursuits with expected revenue and close timing."/><OpportunityForm key={accountContextId ? `new-account-${accountContextId}` : "new"} userId={actor.id} accountContextId={accountContextId} {...options} owners={owners} defaultOwnerId={defaultEligibleUserId(owners, actor.id) ?? undefined} labels={labels}/></Content>;
}
