import type { Prisma, ProductPriceTier } from '@prisma/client';

type ProductSkuForClient = {
  id: number;
  partNumber: string;
  description: string | null;
  active: boolean;
  catalogSource: string | null;
  odmSubtype: string | null;
  odmDescription: string | null;
  odmCustomers: { account: { id: number; name: string }; prices: { currencyCode: string; customerPrice: Prisma.Decimal; previousPrice: Prisma.Decimal | null; tariffPercent: Prisma.Decimal; tariffAmount: Prisma.Decimal; finalUnitPrice: Prisma.Decimal; effectiveDate: Date | null; notes: string | null }[] }[];
  baseSku: { id: number; partNumber: string; product: { name: string } } | null;
  prices: { tier: ProductPriceTier; currencyCode: string; amount: Prisma.Decimal }[];
};

export function serializeProductSku(sku: ProductSkuForClient) {
  return {
    id: sku.id,
    partNumber: sku.partNumber,
    description: sku.description,
    active: sku.active,
    catalogSource: sku.catalogSource,
    odmSubtype: sku.odmSubtype,
    odmDescription: sku.odmDescription,
    odmCustomers: sku.odmCustomers.map(({ account, prices }) => ({ account: { id: account.id, name: account.name }, prices: prices.map(price => ({ currencyCode: price.currencyCode, customerPrice: price.customerPrice.toFixed(2), previousPrice: price.previousPrice?.toFixed(2) ?? null, tariffPercent: price.tariffPercent.toString(), tariffAmount: price.tariffAmount.toFixed(2), finalUnitPrice: price.finalUnitPrice.toFixed(2), effectiveDate: price.effectiveDate?.toISOString().slice(0,10) ?? null, notes: price.notes })) })),
    baseSku: sku.baseSku ? {
      id: sku.baseSku.id,
      partNumber: sku.baseSku.partNumber,
      product: { name: sku.baseSku.product.name },
    } : null,
    prices: sku.prices.map(price => ({
      tier: price.tier,
      currencyCode: price.currencyCode,
      amount: price.amount.toFixed(2),
    })),
  };
}
