import type { Prisma } from '@prisma/client';
import { eligibleUserWhere, type Eligibility } from './assignment-eligibility';
import { businessToday } from './price-exception-dates';

export const unavailableUser = (policy: Eligibility): Prisma.UserWhereInput => ({ NOT: eligibleUserWhere(policy) });
export const activeDemoWhere: Prisma.DemoRequestWhereInput = {
  OR: [
    { status: { in: ['PENDING', 'APPROVED'] } },
    { items: { some: { units: { some: { status: 'DEPLOYED', returnedAt: null } } } } },
  ],
};
export const activeTradeShowLeadWhere: Prisma.TradeShowLeadWhereInput = {
  tradeShow: { archivedAt: null }, routing: 'BIXOLON_SALES', convertedOpportunityId: null,
  status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
};
export function activeTradeShowWhere(now: Date): Prisma.TradeShowWhereInput {
  return { archivedAt: null, OR: [{ endDate: null }, { endDate: { gte: businessToday(now) } }] };
}
export function activePeFollowUpWhere(now = new Date()): Prisma.PriceExceptionWhereInput {
  const through = businessToday(now);
  through.setUTCDate(through.getUTCDate() + 91);
  return { status: 'ACTIVE', archivedAt: null,
    OR: [{ followUp: null, expirationDate: { lt: through } }, { followUp: { status: { notIn: ['COMPLETED', 'NO_RENEWAL_NEEDED'] } } }],
  };
}
