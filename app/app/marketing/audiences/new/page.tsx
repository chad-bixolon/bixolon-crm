import { NAV_CATEGORIES } from '../../../../lib/navigation-categories';
import { Content, PageHeader } from "@/components/shell";
import { MarketingAudienceForm } from "@/components/marketing-audience-form";
import { requirePermission } from "@/lib/current-user";
import { can } from "@/lib/authorization";
import { audienceBuilderOptions } from "@/lib/marketing-audiences";
import { prisma } from "@/lib/prisma";
import { getModuleAvailability } from '@/lib/module-availability';
export const dynamic="force-dynamic";
export default async function NewAudiencePage(){const actor=await requirePermission("marketing.read");if(!can(actor,"marketing.write"))return <Content><PageHeader eyebrow={NAV_CATEGORIES.marketing} title="New Marketing Audience"/><div className="panel p-6">You have read-only Marketing access.</div></Content>;const tradeShowsEnabled=(await getModuleAvailability()).effective.has('TRADE_SHOWS');const options=await audienceBuilderOptions(prisma,{},tradeShowsEnabled);return <Content><PageHeader eyebrow={NAV_CATEGORIES.marketing} title="New Marketing Audience" description="Build a reusable Contact audience using current CRM data."/><MarketingAudienceForm options={options} tradeShowsEnabled={tradeShowsEnabled}/></Content>}
