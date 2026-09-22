import type { ProductPriceTier } from "@prisma/client";

export const priceTierOrder: ProductPriceTier[] = ["STANDARD", "MSRP", "RESELLER", "DISTRIBUTOR"];
export type CatalogPrice = { tier: ProductPriceTier; currencyCode: string; amount: string };
export type OdmCatalogPrice = { id: number; currencyCode: string; customerPrice: string; tariffPercent: string; tariffAmount: string; finalUnitPrice: string; effectiveDate: string | null };
export type CatalogItem = { id: number; productId: number; productName: string; categoryId: number | null; partNumber: string; description: string | null; catalogSource?: string | null; odmSubtype?: string | null; odmCustomers?: { accountId: number; name: string; prices?: OdmCatalogPrice[] }[]; odmDescription?: string | null; prices: CatalogPrice[] };

export function matchingOdmCustomers(item: CatalogItem | null, accountIds: number[], currencyCode: string) {
  if (item?.catalogSource !== 'ODM' || item.odmSubtype !== 'CUSTOMER_SPECIFIC') return [];
  return (item.odmCustomers ?? []).filter(customer => accountIds.includes(customer.accountId)).map(customer => ({ ...customer, price: customer.prices?.find(price => price.currencyCode === currencyCode) ?? null }));
}

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

export function odmCustomerWarning(item: CatalogItem | null, participatingAccountIds: number[]) {
  if (item?.catalogSource !== 'ODM' || (item.odmSubtype && item.odmSubtype !== 'CUSTOMER_SPECIFIC')) return null;
  if (!item.odmCustomers?.length) return item.odmSubtype === 'CUSTOMER_SPECIFIC' ? 'This customer-specific ODM SKU has no associated Account.' : 'This ODM SKU is not associated with any Account participating in this Opportunity.';
  return item.odmCustomers.some(customer => participatingAccountIds.includes(customer.accountId)) ? null
    : 'This ODM SKU is not associated with any Account participating in this Opportunity.';
}
