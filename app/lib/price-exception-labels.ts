import type { PriceExceptionSourceType, PriceExceptionStatus } from '@prisma/client';

const sourceTypeLabels: Record<PriceExceptionSourceType, string> = {
  LEGACY_WORKBOOK: 'Legacy Workbook',
  EXTERNAL_EXPORT: 'External Export',
};

export function priceExceptionSourceTypeLabel(sourceType: PriceExceptionSourceType): string {
  return sourceTypeLabels[sourceType];
}

const statusLabels: Record<PriceExceptionStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  ARCHIVED: 'Archived',
};

export function priceExceptionStatusLabel(status: PriceExceptionStatus): string {
  return statusLabels[status];
}
