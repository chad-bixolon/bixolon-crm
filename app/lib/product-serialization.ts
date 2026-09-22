import type { Prisma, ProductPriceTier } from '@prisma/client';

type ProductSkuForClient = {
  id: number;
  partNumber: string;
  description: string | null;
  active: boolean;
  catalogSource: string | null;
  odmSubtype: string | null;
  odmDescription: string | null;
  odmCustomers: { account: { id: number; name: string } }[];
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
    odmCustomers: sku.odmCustomers.map(({ account }) => ({ account: { id: account.id, name: account.name } })),
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
