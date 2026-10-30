import type { Prisma, PartnerHandoffStatus, TradeShowLeadRouting, TradeShowLeadStatus } from '@prisma/client';

type Assignment = {
  routing: TradeShowLeadRouting; routedPartnerAccountId: number | null;
  status?: TradeShowLeadStatus; convertedOpportunityId?: number | null;
  partnerHandoffStatus?: PartnerHandoffStatus | null; partnerAssignmentVersion?: number;
};
export const actionablePartnerStatuses: TradeShowLeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED'];
export function partnerAssignmentData(before: Assignment | null, after: Assignment, now = new Date()): Pick<Prisma.TradeShowLeadUncheckedUpdateInput, 'partnerHandoffStatus'|'partnerAssignmentVersion'|'partnerAwaitingAt'|'partnerSentAt'> {
  if (after.routing !== 'REFERRED_TO_PARTNER') return { partnerHandoffStatus: null, partnerAwaitingAt: null, partnerSentAt: null };
  const changed = !before || before.routing !== after.routing || before.routedPartnerAccountId !== after.routedPartnerAccountId;
  const actionable = !after.convertedOpportunityId && actionablePartnerStatuses.includes(after.status ?? 'NEW');
  if (changed || (!before?.partnerHandoffStatus && actionable)) return {
    partnerHandoffStatus: actionable ? 'AWAITING_PARTNER_HANDOFF' : null,
    partnerAssignmentVersion: (before?.partnerAssignmentVersion ?? 0) + 1,
    partnerAwaitingAt: actionable ? now : null, partnerSentAt: null,
  };
  if (!actionable && before?.partnerHandoffStatus === 'AWAITING_PARTNER_HANDOFF') return { partnerHandoffStatus: null, partnerAwaitingAt: null, partnerSentAt: null };
  return {};
}

export async function auditPartnerAssignment(tx: Prisma.TransactionClient, before: Assignment, after: Assignment & { id: number }, actorId: number) {
  if (before.routing === after.routing && before.routedPartnerAccountId === after.routedPartnerAccountId) return;
  if (before.routing !== 'REFERRED_TO_PARTNER' && after.routing !== 'REFERRED_TO_PARTNER') return;
  if (!tx.adminMaintenanceEvent) return; // Older isolated routing test clients.
  const label = async (a: Assignment) => {
    const partner = a.routedPartnerAccountId ? await tx.account.findUnique({ where: { id: a.routedPartnerAccountId }, select: { name: true } }) : null;
    return `${a.routing}; partner ${a.routedPartnerAccountId ?? 'none'}${partner ? ` (${partner.name.slice(0, 200)})` : ''}`;
  };
  await tx.adminMaintenanceEvent.create({ data: { actorId, entityType: 'Trade Show Lead', action: 'Partner assignment', recordIds: [after.id], recordCount: 1, oldValue: await label(before), newValue: await label(after) } });
}
