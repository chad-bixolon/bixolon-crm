import type { ProductPriceTier } from "@prisma/client";

export const priceTierOrder: ProductPriceTier[] = ["STANDARD", "MSRP", "RESELLER", "DISTRIBUTOR"];
export type CatalogPrice = { tier: ProductPriceTier; currencyCode: string; amount: string };
export type CatalogItem = { id: number; productId: number; productName: string; categoryId: number | null; partNumber: string; description: string | null; prices: CatalogPrice[] };

export function pricesForCurrency(item: CatalogItem, currencyCode: string) {
  return item.prices.filter(price => price.currencyCode === currencyCode).sort((a, b) => priceTierOrder.indexOf(a.tier) - priceTierOrder.indexOf(b.tier));
}
export function defaultPrice(prices: CatalogPrice[]) {
  return prices.find(price => price.tier === "STANDARD") ?? (prices.length === 1 ? prices[0] : null);
}

export function selectCatalogItem(item: CatalogItem, currencyCode: string) {
  const selected = defaultPrice(pricesForCurrency(item, currencyCode));
  return { productId: item.productId, skuId: item.id, tier: (selected?.tier ?? "") as ProductPriceTier | "", price: selected?.amount ?? "0.00" };
}

export function selectedProductFitsCategory(selectedCategoryId: number | null, productCategoryId: number | null) {
  return selectedCategoryId === null || selectedCategoryId === productCategoryId;
}
