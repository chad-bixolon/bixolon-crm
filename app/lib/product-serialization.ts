import type { Prisma } from '@prisma/client';

type ProductWithPricing = Prisma.ProductGetPayload<{
  include: { skus: { include: { prices: true } } };
}>;

export function serializeProductPricing(product: ProductWithPricing) {
  return {
    ...product,
    skus: product.skus.map(sku => ({
      ...sku,
      prices: sku.prices.map(price => ({
        ...price,
        amount: price.amount.toFixed(2),
      })),
    })),
  };
}
