import { Prisma, type PrismaClient } from "@prisma/client";

export type SearchCandidate = { id: number; partNumber: string; description: string | null; product: { name: string; sku: string } };
export const resultLimit = 25;

export function catalogRank(item: SearchCandidate, query: string) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return 0;
  const model = item.product.name.toLocaleLowerCase();
  const skus = [item.partNumber, item.product.sku].map(value => value.toLocaleLowerCase());
  if (model === q) return 0;
  if (skus.some(value => value === q)) return 1;
  if (model.startsWith(q)) return 2;
  if (skus.some(value => value.startsWith(q))) return 3;
  if (model.includes(q)) return 4;
  if (skus.some(value => value.includes(q))) return 5;
  return 6;
}

export function rankCatalogResults<T extends SearchCandidate>(items: T[], query: string, limit = resultLimit) {
  return [...items].sort((a, b) => catalogRank(a, query) - catalogRank(b, query)
    || a.product.name.localeCompare(b.product.name)
    || a.partNumber.localeCompare(b.partNumber)
    || a.id - b.id).slice(0, limit);
}

export async function searchCatalog(client: PrismaClient, query: string, categoryId: number | null, currencyCode: string) {
  const where: Prisma.ProductSkuWhereInput = {
    active: true, product: { active: true, archivedAt: null, ...(categoryId !== null ? { categoryId } : {}) },
  };
  if (query) where.OR = [
    { product: { name: { contains: query, mode: "insensitive" } } },
    { product: { sku: { contains: query, mode: "insensitive" } } },
    { partNumber: { contains: query, mode: "insensitive" } },
    { description: { contains: query, mode: "insensitive" } },
  ];
  const candidates = await client.productSku.findMany({ where, select: {
    id: true, partNumber: true, description: true, product: { select: { name: true, sku: true } },
  } });
  const ids = rankCatalogResults(candidates, query).map(item => item.id);
  if (!ids.length) return [];
  const rows = await client.productSku.findMany({ where: { id: { in: ids } }, select: {
    id: true, productId: true, partNumber: true, description: true,
    product: { select: { name: true, categoryId: true } },
    prices: { where: { currencyCode }, select: { tier: true, currencyCode: true, amount: true } },
  } });
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.flatMap(id => {
    const row = byId.get(id);
    return row ? [{ id: row.id, productId: row.productId, productName: row.product.name, categoryId: row.product.categoryId,
      partNumber: row.partNumber, description: row.description,
      prices: row.prices.map(price => ({ tier: price.tier, currencyCode: price.currencyCode, amount: price.amount.toFixed(2) })) }] : [];
  });
}
