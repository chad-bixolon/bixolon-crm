import type { TradeShowLeadRouting } from '@prisma/client';

export const routedTradeShowDestinations: TradeShowLeadRouting[] = ['BIXOLON_SALES', 'REFERRED_TO_PARTNER', 'MARKETING_FOLLOW_UP'];
export function routedTradeShowCount(counts: Partial<Record<TradeShowLeadRouting, number>>) {
  return routedTradeShowDestinations.reduce((total, destination) => total + (counts[destination] ?? 0), 0);
}
