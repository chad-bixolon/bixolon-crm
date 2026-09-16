import { Content, PageHeader } from "@/components/shell";
import { OpportunityForm } from "@/components/opportunity-form";
import { opportunityOptions } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function NewOpportunityPage() { const options = await opportunityOptions(prisma); return <Content><PageHeader eyebrow="Opportunities" title="New opportunity"/><OpportunityForm key="new" {...options}/></Content>; }
