import type { TradeShowImportFormat } from '@prisma/client';

// Preserve historical template names; the selected Trade Show supplies event context.
export const importTemplateLabels: Record<TradeShowImportFormat, string> = {
  NRA_NRF: 'NRA / NRF',
  XPRESSLEADS_MODEX: 'MODEX / XPressLeads',
  CUSTOM_MAPPING: 'Custom column mapping',
};
