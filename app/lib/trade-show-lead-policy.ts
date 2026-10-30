import { can, type Actor } from './authorization';

// Shared with dashboard presentation; keep server routing/signing dependencies out.
export function canViewSalesLeadQueue(actor: Actor) {
  return can(actor, 'trade-shows.read') && ['SALES', 'SALES_MANAGER', 'ADMIN'].includes(actor.role);
}
