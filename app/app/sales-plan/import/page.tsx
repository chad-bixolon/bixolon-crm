import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { ImportWorkflow } from './workflow';
export const dynamic='force-dynamic';
export default async function Page(){await requirePermission('sales-plan.manage');const [users,currencies,mappings]=await Promise.all([prisma.user.findMany({where:{role:{in:['SALES','SALES_MANAGER']}},select:{id:true,firstName:true,lastName:true,active:true,archivedAt:true},orderBy:{lastName:'asc'}}),prisma.currency.findMany({where:{active:true},select:{code:true},orderBy:{code:'asc'}}),prisma.salesPlanImportMapping.findMany({where:{archivedAt:null},select:{id:true,name:true,mappings:true},orderBy:{createdAt:'desc'},take:100})]);return <Content><PageHeader title="Import Sales Plan" eyebrow="Management" description="Review worksheet mappings and every proposed line before activating an official revision."/><ImportWorkflow users={users.map(user=>({id:user.id,firstName:user.firstName,lastName:user.lastName,eligible:user.active&&!user.archivedAt}))} currencies={currencies.map(c=>c.code)} initialMappings={mappings}/></Content>}
