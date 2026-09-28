type PricingLine = {
  sourceSku: string | null;
  sourceQuantity: { toString(): string } | null;
  sourceQuantityRaw: string | null;
  productSku: { partNumber: string; product: { name: string } } | null;
};

export function priceExceptionListSummary(lines: PricingLine[]) {
  const skus = new Map<string, { product: string | null; sku: string }>();
  const quantities = new Map<string, string>();

  for (const line of lines) {
    const sku = line.productSku?.partNumber ?? line.sourceSku?.trim();
    if (sku) skus.set(sku.toLowerCase(), { product: line.productSku?.product.name ?? null, sku });

    const numeric = line.sourceQuantity?.toString();
    const quantity = numeric ? numeric.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : line.sourceQuantityRaw?.trim();
    if (quantity) quantities.set(quantity.toLowerCase(), quantity);
  }

  const products = [...skus.values()];
  const tiers = [...quantities.values()].sort((a, b) => {
    const aNumber = Number(a.replaceAll(',', ''));
    const bNumber = Number(b.replaceAll(',', ''));
    return Number.isFinite(aNumber) && Number.isFinite(bNumber) ? aNumber - bNumber : a.localeCompare(b, undefined, { numeric: true });
  });
  return {
    product: products[0] ?? null,
    skuCount: products.length,
    tierText: tiers.length === 1 ? `MOQ: ${tiers[0]}` : tiers.length <= 3 ? tiers.join(' / ') || '—' : `${tiers.length} tiers`,
    tierTitle: tiers.join(' / '),
  };
}
