import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { businessToday } from './price-exception-expiration';
import { scopedPriceExceptionWhere } from './price-exception-visibility';

export function canManagePriceExceptionLifecycle(actor: Actor) {
  return actor.role === 'ADMIN' && can(actor, 'users.manage') ||
    actor.role === 'SALES_MANAGER' && can(actor, 'sales.write');
}

export function canMarkPriceExceptionExpired(row: {status: string; archivedAt: Date | null; expirationDate: Date | null}, today = businessToday()) {
  return row.status === 'ACTIVE' && row.archivedAt === null && !!row.expirationDate && row.expirationDate < today;
}

export async function markPriceExceptionExpired(db: PrismaClient, actor: Actor, id: number, now = new Date()) {
  if (!canManagePriceExceptionLifecycle(actor)) throw new Error('Access denied');
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid Price Exception.');
  return db.$transaction(async tx => {
    const row = await tx.priceException.findFirst({where: scopedPriceExceptionWhere(actor, {id}), select: {id:true,status:true,archivedAt:true,expirationDate:true,updatedAt:true}});
    if (!row || !canMarkPriceExceptionExpired(row, businessToday(now))) throw new Error('Price Exception is no longer eligible to be marked Expired.');
    const updated = await tx.priceException.updateMany({where:{id, status:'ACTIVE', archivedAt:null, expirationDate:{lt:businessToday(now)}, updatedAt:row.updatedAt}, data:{status:'EXPIRED',updatedById:actor.id}});
    if (updated.count !== 1) throw new Error('Price Exception changed. Refresh and try again.');
    await tx.priceExceptionLifecycleEvent.create({data:{priceExceptionId:id,oldStatus:'ACTIVE',newStatus:'EXPIRED',actorId:actor.id,source:'Manual detail action',createdAt:now}});
    return true;
  }, {isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
