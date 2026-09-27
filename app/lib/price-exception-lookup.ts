import { Prisma, ProductCatalogSource, type PrismaClient } from '@prisma/client';
import type { Actor } from './authorization';
import { pageNumber } from './crm-validation';
import { scopedPriceExceptionWhere } from './price-exception-visibility';

export type PriceExceptionLookupFilters = {
  account?: string;
  sku?: string;
  productId?: string;
  skuId?: string;
  catalogSource?: string;
  page?: string;
};

export function activePriceExceptionLineWhere(
  actor: Actor,
  filters: PriceExceptionLookupFilters = {},
  now = new Date(),
): Prisma.PriceExceptionLineWhereInput {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const parent: Prisma.PriceExceptionWhereInput = {
    status: 'ACTIVE',
    archivedAt: null,
    OR: [{ expirationDate: null }, { expirationDate: { gte: today } }],
    AND: [{ OR: [
      { distributorAccount: { status: 'ACTIVE', archivedAt: null } },
      { varAccount: { status: 'ACTIVE', archivedAt: null } },
      { endUserAccount: { status: 'ACTIVE', archivedAt: null } },
    ] }],
  };
  const account = filters.account?.trim().slice(0, 100);
  if (account) (parent.AND as Prisma.PriceExceptionWhereInput[]).push({ OR: [
    { distributorAccount: { name: { contains: account, mode: 'insensitive' }, status: 'ACTIVE', archivedAt: null } },
    { varAccount: { name: { contains: account, mode: 'insensitive' }, status: 'ACTIVE', archivedAt: null } },
    { endUserAccount: { name: { contains: account, mode: 'insensitive' }, status: 'ACTIVE', archivedAt: null } },
  ] });
  const sku: Prisma.ProductSkuWhereInput = {
    active: true,
    product: { active: true, archivedAt: null },
  };
  if (Object.values(ProductCatalogSource).includes(filters.catalogSource as ProductCatalogSource))
    sku.catalogSource = filters.catalogSource as ProductCatalogSource;
  const productId = Number(filters.productId);
  if (filters.productId && Number.isSafeInteger(productId) && productId > 0) sku.productId = productId;
  else if (filters.productId) sku.id = -1;
  const skuId = Number(filters.skuId);
  if (filters.skuId && Number.isSafeInteger(skuId) && skuId > 0) sku.id = skuId;
  else if (filters.skuId) sku.id = -1;
  const query = filters.sku?.trim().slice(0, 100);
  if (query) sku.OR = [
    { partNumber: { contains: query, mode: 'insensitive' } },
    { product: { name: { contains: query, mode: 'insensitive' } } },
  ];
  return {
    retiredAt: null,
    approvedUnitPrice: { not: null },
    sourceQuantity: { gt: 0 },
    productSku: sku,
    priceException: scopedPriceExceptionWhere(actor, parent),
  };
}

export async function listActivePriceExceptionLines(
  db: PrismaClient,
  actor: Actor,
  filters: PriceExceptionLookupFilters,
  now = new Date(),
) {
  const where = activePriceExceptionLineWhere(actor, filters, now);
  const count = await db.priceExceptionLine.count({ where });
  const { page, pages } = pageNumber(filters.page, count);
  const rows = await db.priceExceptionLine.findMany({
    where,
    orderBy: [{ priceException: { expirationDate: 'asc' } }, { priceExceptionId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * 25,
    take: 25,
    include: {
      productSku: { select: { id: true, partNumber: true, product: { select: { id: true, name: true } } } },
      priceException: { select: {
        id: true, peCode: true, status: true, expirationDate: true,
        distributorAccount: { select: { id: true, name: true, status: true, archivedAt: true } },
        varAccount: { select: { id: true, name: true, status: true, archivedAt: true } },
        endUserAccount: { select: { id: true, name: true, status: true, archivedAt: true } },
        distributorSourceName: true, varSourceName: true, endUserSourceName: true,
      } },
    },
  });
  return { rows, count, page, pages };
}

export function priceExceptionLookupHref(filters: PriceExceptionLookupFilters, page?: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value && key !== 'page') params.set(key, value);
  if (page !== undefined) params.set('page', String(page));
  return `/price-exceptions/lookup?${params}`;
}
