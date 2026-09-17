import { Content, PageHeader } from "@/components/shell";
import { OpportunityForm } from "@/components/opportunity-form";
import { opportunityOptions } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
import { getLabels } from "@/lib/configuration";
export const dynamic = "force-dynamic";
export default async function NewOpportunityPage() { const [options, labels] = await Promise.all([opportunityOptions(prisma), getLabels(prisma)]); return <Content><PageHeader eyebrow="Opportunities" title="New opportunity"/><OpportunityForm key="new" {...options} labels={labels}/></Content>; }
