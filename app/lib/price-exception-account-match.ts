import type { OpportunityPartyRole } from '@prisma/client';

export type PriceExceptionAccounts = {
  distributorAccountId: number | null;
  varAccountId: number | null;
  endUserAccountId: number | null;
};

export type OpportunityParticipant = { accountId: number; roles: OpportunityPartyRole[] };

export const unrelatedPriceExceptionMessage = 'This Price Exception belongs to a customer that is not part of this Opportunity.';

export function priceExceptionMatchesParticipants(
  accounts: PriceExceptionAccounts | null | undefined,
  participants: OpportunityParticipant[],
): boolean {
  if (!accounts) return false;
  return participants.some(participant =>
    (participant.accountId === accounts.distributorAccountId && participant.roles.some(role => role === 'DISTRIBUTOR' || role === 'OEM')) ||
    (participant.accountId === accounts.varAccountId && participant.roles.some(role => role === 'VAR_RESELLER' || role === 'ISV_PARTNER')) ||
    (participant.accountId === accounts.endUserAccountId && participant.roles.includes('END_USER')),
  );
}
