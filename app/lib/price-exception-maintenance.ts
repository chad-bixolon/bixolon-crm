import { assertEditToken, nextUpdatedAt, RecordChangedError } from './stale-edit';
import { recordMaintenance } from './admin-maintenance';
import type { PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';

export type MaintenanceField = 'distributorAccountId'|'varAccountId'|'endUserAccountId'|'assignedSalesRepUserId'|'productSkuId';
export async function correctPriceExceptionReference(db:PrismaClient,actor:Actor,peId:number,field:MaintenanceField,targetId:number,expectedUpdatedAt:Date,lineId?:number){
  assertPermission(actor,'users.manage');
  if(actor.role!=='ADMIN')throw new Error('Administrator access required.');
  if(!Number.isSafeInteger(peId)||peId<=0||!Number.isSafeInteger(targetId)||targetId<=0||!Number.isFinite(expectedUpdatedAt.getTime()))throw new Error('Invalid correction.');
  if(!['distributorAccountId','varAccountId','endUserAccountId','assignedSalesRepUserId','productSkuId'].includes(field))throw new Error('Invalid correction field.');
  return db.$transaction(async tx=>{
    const pe=await tx.priceException.findUnique({where:{id:peId},select:{updatedAt:true,archivedAt:true,status:true}});
    if(!pe||pe.archivedAt||pe.status==='ARCHIVED')throw new Error('Only live Price Exceptions can be corrected.');
    assertEditToken(pe.updatedAt, expectedUpdatedAt.toISOString());
    // The conditional parent write holds its row lock until all related changes and history commit.
    const claim = async () => {
      const result = await tx.priceException.updateMany({
        where: { id: peId, updatedAt: expectedUpdatedAt, archivedAt: null, status: { not: 'ARCHIVED' } },
        data: { ...(field === 'productSkuId' ? {} : { [field]: targetId }), updatedById: actor.id, updatedAt: nextUpdatedAt(pe.updatedAt) },
      });
      if (result.count !== 1) throw new RecordChangedError();
    };
    if(field==='productSkuId'){
      if(!Number.isSafeInteger(lineId)||!lineId||lineId<=0)throw new Error('Choose a pricing line.');
      const sku=await tx.productSku.findUnique({where:{id:targetId},select:{active:true,product:{select:{active:true,archivedAt:true}}}});
      if(!sku?.active||!sku.product.active||sku.product.archivedAt)throw new Error('Choose an active SKU.');
      const line=await tx.priceExceptionLine.findFirst({where:{id:lineId,priceExceptionId:peId,retiredAt:null},select:{id:true}});
      if(!line)throw new Error('Pricing line not found.');
      await claim();
      await tx.priceExceptionLine.update({where:{id:line.id},data:{productSkuId:targetId}});
      await recordMaintenance(tx, actor.id, 'Price Exception', 'Corrected Price Exception SKU', [peId]);
      return;
    }
    if(field==='assignedSalesRepUserId'){
      const user=await tx.user.findUnique({where:{id:targetId},select:{active:true,archivedAt:true,role:true}});
      if(!user?.active||user.archivedAt||!['SALES','SALES_MANAGER'].includes(user.role))throw new Error('Choose an active salesperson.');
    }else{
      const account=await tx.account.findUnique({where:{id:targetId},select:{status:true,archivedAt:true}});
      if(account?.status!=='ACTIVE'||account.archivedAt)throw new Error('Choose an active Account.');
    }
    await claim();
    await recordMaintenance(tx, actor.id, 'Price Exception', 'Updated Price Exception reference', [peId]);
  });
}
