import type { PrismaClient } from '@prisma/client';
import { assertPermission, can, type Actor } from './authorization';

/** Catalog tiers stay visible; negotiated rows are never fetched without pricing.read. */
export async function productDetailData(client: PrismaClient, actor: Actor, id: number) {
  assertPermission(actor, 'products.read');
  const readPricing = can(actor, 'pricing.read');
  const product = await client.product.findUnique({ where: { id }, include: { category: true, skus: { include: { prices: true, odmCustomers: { where: { archivedAt: null }, include: { account: { select: { id: true, name: true } }, prices: readPricing ? { where: { archivedAt: null } } : false }, orderBy: { accountId: "asc" } }, baseSku: { select: { id: true, partNumber: true, productId: true, product: { select: { name: true } } } } }, orderBy: { partNumber: 'asc' } } } });
  if (!product) return null;
  return { ...product, skus: product.skus.map(sku => ({ ...sku, odmCustomers: sku.odmCustomers.map(link => ({ ...link, prices: readPricing ? link.prices : [] })) })) };
}
