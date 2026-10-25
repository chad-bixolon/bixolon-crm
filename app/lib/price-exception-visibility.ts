import type { Prisma, PriceExceptionSourceType } from '@prisma/client';
import type { Actor } from './authorization';

export type PriceExceptionVisibilityRecord = {
  assignedSalesRepUserId: number | null;
  sourceType: PriceExceptionSourceType;
  followUp?: { ownerId: number | null } | null;
};

/** SALES users see their historically assigned PEs, current follow-up work, and unassigned legacy workbook PEs.
 * All other roles with pricing.read retain their existing all-PE visibility.
 */
export function priceExceptionVisibilityWhere(actor: Actor): Prisma.PriceExceptionWhereInput {
  return actor.role === 'SALES' ? {
    OR: [
      { assignedSalesRepUserId: actor.id },
      { followUp: { is: { ownerId: actor.id } } },
      { assignedSalesRepUserId: null, sourceType: 'LEGACY_WORKBOOK' },
    ],
  } : {};
}

export function canViewPriceException(actor: Actor, priceException: PriceExceptionVisibilityRecord) {
  return actor.role !== 'SALES' || priceException.assignedSalesRepUserId === actor.id || priceException.followUp?.ownerId === actor.id ||
    (priceException.assignedSalesRepUserId === null && priceException.sourceType === 'LEGACY_WORKBOOK');
}

export function scopedPriceExceptionWhere(actor: Actor, where: Prisma.PriceExceptionWhereInput = {}): Prisma.PriceExceptionWhereInput {
  const visibility = priceExceptionVisibilityWhere(actor);
  return Object.keys(visibility).length ? { AND: [visibility, where] } : where;
}
