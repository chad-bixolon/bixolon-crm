import { Content, PageHeader } from "@/components/shell";
import { MarketingAudienceForm } from "@/components/marketing-audience-form";
import { requirePermission } from "@/lib/current-user";
import { can } from "@/lib/authorization";
import { audienceBuilderOptions } from "@/lib/marketing-audiences";
import { prisma } from "@/lib/prisma";
export const dynamic="force-dynamic";
export default async function NewAudiencePage(){const actor=await requirePermission("marketing.read");if(!can(actor,"marketing.write"))return <Content><PageHeader title="New Marketing Audience"/><div className="panel p-6">You have read-only Marketing access.</div></Content>;const options=await audienceBuilderOptions(prisma);return <Content><PageHeader eyebrow="Marketing Audiences" title="New Marketing Audience" description="Build a reusable Contact audience using current SalesHub data."/><MarketingAudienceForm options={options}/></Content>}
