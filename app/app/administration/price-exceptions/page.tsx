import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { classifyPriceException, duplicatePeCodes, cleanupIssueKeys, type CleanupRecord } from '@/lib/price-exception-cleanup';
import { CleanupWorkflow } from './workflow';

export const dynamic = 'force-dynamic';
export default async function PriceExceptionCleanupPage() {
  const actor = await requirePermission('users.manage');
  if (actor.role !== 'ADMIN') return <Content><p>Administrator access required.</p></Content>;
  const [records, salesReps, accounts] = await Promise.all([
    prisma.priceException.findMany({
      orderBy: { id: 'desc' },
      include: {
        distributorAccount: { select: { id:true,name:true,status:true,archivedAt:true,ownerId:true } },
        varAccount: { select: { id:true,name:true,status:true,archivedAt:true,ownerId:true } },
        endUserAccount: { select: { id:true,name:true,status:true,archivedAt:true,ownerId:true } },
        lines: { select: { productSkuId:true,sourceSku:true,opportunityProducts:{select:{opportunity:{select:{ownerId:true}}}} } },
      },
    }),
    prisma.user.findMany({ where: { active:true, archivedAt:null,role:{in:['SALES','SALES_MANAGER']} }, select:{id:true,firstName:true,lastName:true},orderBy:[{lastName:'asc'},{firstName:'asc'}] }),
    prisma.account.findMany({ where: { status:'ACTIVE',archivedAt:null }, select:{id:true,name:true},orderBy:{name:'asc'} }),
  ]);
  const duplicates = duplicatePeCodes(records);
  const today = new Date();
  const startToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const rows = records.map(record => {
    const issues = classifyPriceException(record as CleanupRecord, duplicates, startToday);
    const clues = new Set<number>();
    for (const account of [record.distributorAccount,record.varAccount,record.endUserAccount]) if (account?.ownerId) clues.add(account.ownerId);
    for (const line of record.lines) for (const product of line.opportunityProducts) if (product.opportunity.ownerId) clues.add(product.opportunity.ownerId);
    const creator = record.sourceType === 'LEGACY_WORKBOOK' ? null : record.createdById;
    return { id:record.id, code:record.peCode ?? `#${record.id}`,status:record.status,sourceType:record.sourceType,
      expiration:record.expirationDate?.toISOString().slice(0,10) ?? null,
      owner: salesReps.find(user => user.id === record.assignedSalesRepUserId)?.firstName ?? (record.assignedSalesRepUserId ? `User #${record.assignedSalesRepUserId}` : 'Unassigned'),
      parties: [record.distributorAccount?.name ?? record.distributorSourceName,record.varAccount?.name ?? record.varSourceName,record.endUserAccount?.name ?? record.endUserSourceName].filter(Boolean).join(' · ') || 'No customer details',
      issues, clues: [...clues].map(id => salesReps.find(user => user.id === id)).filter((user): user is typeof salesReps[number] => !!user).map(user => `${user.firstName} ${user.lastName}`),
      creator: creator ? `Creator #${creator}` : null,
      sourceRep: [record.sourceSalesRepName, record.distributorSalesRep].filter(Boolean).join(' / ') || null,
      eligible: { assignOwner: record.assignedSalesRepUserId === null && !record.archivedAt && record.status !== 'ARCHIVED',
        linkDistributor: record.distributorAccountId === null && !record.archivedAt && record.status !== 'ARCHIVED',
        linkVar: record.varAccountId === null && !record.archivedAt && record.status !== 'ARCHIVED',
        linkEndUser: record.endUserAccountId === null && !record.archivedAt && record.status !== 'ARCHIVED',
        expire: record.status === 'ACTIVE' && !!record.expirationDate && record.expirationDate < startToday && !record.archivedAt,
        archive: !record.archivedAt && record.status !== 'ARCHIVED' } };
  });
  const counts = Object.fromEntries(cleanupIssueKeys.map(key => [key, rows.filter(row => row.issues.includes(key)).length]));
  return <Content><PageHeader eyebrow="Administration" title="Price Exception cleanup" description="Audit legacy records, review possible ownership clues, and preview limited bulk corrections." action={<Link className="btn-secondary" href="/price-exceptions">Price Exceptions</Link>}/><CleanupWorkflow rows={rows} counts={counts} salesReps={salesReps} accounts={accounts}/></Content>;
}
