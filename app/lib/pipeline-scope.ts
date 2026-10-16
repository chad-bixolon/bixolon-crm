import type { Prisma } from '@prisma/client';
import { assertPermission, opportunityScope, type Actor } from './authorization';
import { selectedSalesRepWhere } from './assignment-eligibility';
import { positiveId } from './crm-validation';

/** Standalone Pipeline defaults to My pipeline for Sales; an explicit rep replaces that default. */
export function pipelineScope(actor: Actor, selectedOwner?: string): Prisma.OpportunityWhereInput {
  assertPermission(actor, 'sales.read');
  if (!selectedOwner) return opportunityScope(actor);
  if (actor.role === 'SALES') return { owner: { is: selectedSalesRepWhere(selectedOwner)! } };
  const ownerId = positiveId(selectedOwner);
  return ownerId ? { ownerId } : { id: -1 };
}
