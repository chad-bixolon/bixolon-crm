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
    if(pe.updatedAt.getTime()!==expectedUpdatedAt.getTime())throw new Error('Price Exception changed. Refresh and review again.');
    if(field==='productSkuId'){
      if(!Number.isSafeInteger(lineId)||!lineId||lineId<=0)throw new Error('Choose a pricing line.');
      const sku=await tx.productSku.findUnique({where:{id:targetId},select:{active:true,product:{select:{active:true,archivedAt:true}}}});
      if(!sku?.active||!sku.product.active||sku.product.archivedAt)throw new Error('Choose an active SKU.');
      const line=await tx.priceExceptionLine.findFirst({where:{id:lineId,priceExceptionId:peId},select:{id:true}});
      if(!line)throw new Error('Pricing line not found.');
      await tx.priceExceptionLine.update({where:{id:line.id},data:{productSkuId:targetId}});
      await tx.priceException.update({where:{id:peId},data:{updatedById:actor.id}});
      return;
    }
    if(field==='assignedSalesRepUserId'){
      const user=await tx.user.findUnique({where:{id:targetId},select:{active:true,archivedAt:true,role:true}});
      if(!user?.active||user.archivedAt||!['SALES','SALES_MANAGER'].includes(user.role))throw new Error('Choose an active salesperson.');
    }else{
      const account=await tx.account.findUnique({where:{id:targetId},select:{status:true,archivedAt:true}});
      if(account?.status!=='ACTIVE'||account.archivedAt)throw new Error('Choose an active Account.');
    }
    await tx.priceException.update({where:{id:peId},data:{[field]:targetId,updatedById:actor.id}});
  });
}
