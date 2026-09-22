import type { Prisma } from '@prisma/client';

export type OdmPriceRecord = { id: number; accountId: number; customerPrice: Prisma.Decimal; tariffPercent: Prisma.Decimal; tariffAmount: Prisma.Decimal; finalUnitPrice: Prisma.Decimal; currencyCode: string; effectiveDate: Date | null };
export type OdmSnapshot = { odmCustomerPriceId: number | null; odmCustomerAccountId: number | null; odmCustomerBasePrice: Prisma.Decimal | null; odmCustomerTariffPercent: Prisma.Decimal | null; odmCustomerTariffAmount: Prisma.Decimal | null; odmCustomerFinalUnitPrice: Prisma.Decimal | null; odmCustomerCurrencyCode: string | null; odmCustomerEffectiveDate: Date | null };

export function odmCustomerSnapshot(selected: OdmPriceRecord | null, previous?: OdmSnapshot | null): OdmSnapshot {
  if (!selected) return { odmCustomerPriceId: null, odmCustomerAccountId: null, odmCustomerBasePrice: null, odmCustomerTariffPercent: null, odmCustomerTariffAmount: null, odmCustomerFinalUnitPrice: null, odmCustomerCurrencyCode: null, odmCustomerEffectiveDate: null };
  if (previous?.odmCustomerPriceId === selected.id && previous.odmCustomerAccountId === selected.accountId) return { ...previous };
  return { odmCustomerPriceId: selected.id, odmCustomerAccountId: selected.accountId, odmCustomerBasePrice: selected.customerPrice, odmCustomerTariffPercent: selected.tariffPercent, odmCustomerTariffAmount: selected.tariffAmount, odmCustomerFinalUnitPrice: selected.finalUnitPrice, odmCustomerCurrencyCode: selected.currencyCode, odmCustomerEffectiveDate: selected.effectiveDate };
}
