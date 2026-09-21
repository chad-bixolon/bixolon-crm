import { Content, PageHeader } from "@/components/shell";
import { OpportunityForm } from "@/components/opportunity-form";
import { opportunityOptions } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
import { getLabels } from "@/lib/configuration";
import { currentUser } from "@/lib/current-user";
export const dynamic = "force-dynamic";
export default async function NewOpportunityPage() { const [options, labels, actor] = await Promise.all([opportunityOptions(prisma), getLabels(prisma), currentUser()]); return <Content><PageHeader eyebrow="Opportunities" title="New opportunity"/><OpportunityForm key="new" {...options} owners={actor.role === 'SALES' ? options.owners.filter(owner => owner.id === actor.id) : options.owners} defaultOwnerId={actor.role === 'SALES' ? actor.id : undefined} labels={labels}/></Content>; }
