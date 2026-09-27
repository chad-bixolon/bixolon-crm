import { Prisma, ProductCatalogSource, type PrismaClient } from "@prisma/client";
import { field, pageNumber, required, type Errors } from "./crm-validation";
import { normalizePartNumber } from "./product-import";
import { DuplicateSkuError, saveSkuMetadataInTransaction, type SkuMetadataInput } from "./odm-skus";
import type { Actor } from './authorization';
import { activePriceExceptionLineWhere } from './price-exception-lookup';
export function parseProduct(form: FormData) {
  const errors: Errors = {};
  const sku = required(form, "sku", "SKU", 100, errors);
  const name = required(form, "name", "Product name", 200, errors);
  const active = field(form, "active") !== "false";
  const categoryText = field(form, "categoryId");
  const categoryId = categoryText ? Number(categoryText) : null;
  if (categoryText && (!Number.isSafeInteger(categoryId) || Number(categoryId) <= 0)) errors.categoryId = "Choose a valid Product Category.";
  return { errors, value: Object.keys(errors).length ? undefined : { sku, name, active, categoryId } };
}
export async function saveProduct(client: PrismaClient, input: { sku: string; name: string; active: boolean; categoryId?: number | null }, id?: number, initialSku?: Omit<SkuMetadataInput, 'productId' | 'skuId'>) {
  return client.$transaction(async tx => {
    const old = id ? await tx.product.findUnique({ where: { id } }) : null;
    if (id && !old) throw new Error("Product not found.");
    if (old?.archivedAt) throw new Error("Reactivate this product before editing it.");
    if (input.categoryId && !await tx.productCategory.count({ where: { id: input.categoryId, active: true } }) && old?.categoryId !== input.categoryId) throw new Error("Choose an active Product Category.");
    const key = normalizePartNumber(input.sku);
    const conflict = await tx.productSku.findUnique({where:{normalizedPartNumber:key},include:{product:{select:{name:true}}}});
    if (conflict && (conflict.productId !== id || old && normalizePartNumber(old.sku) !== key)) throw new DuplicateSkuError({id:conflict.id,partNumber:conflict.partNumber,productId:conflict.productId,productName:conflict.product.name,catalogSource:conflict.catalogSource});
    const row = id ? await tx.product.update({ where: { id }, data: input }) : await tx.product.create({ data: input });
    if (!old) {
      await saveSkuMetadataInTransaction(tx, { description: null, catalogSource: null, odmSubtype: null, odmCustomerAccountIds: [], baseSkuId: null, odmDescription: null, ...initialSku, productId: row.id, partNumber: input.sku, active: input.active });
      return row.id;
    }
    if (old && normalizePartNumber(old.sku) !== key) {
      const primary = await tx.productSku.findUnique({where:{normalizedPartNumber:normalizePartNumber(old.sku)}});
      if (primary?.productId === row.id) await tx.productSku.update({where:{id:primary.id},data:{partNumber:input.sku,normalizedPartNumber:key,active:input.active}});
      else await tx.productSku.create({data:{productId:row.id,partNumber:input.sku,normalizedPartNumber:key,active:input.active}});
    } else if (conflict?.productId === row.id) await tx.productSku.update({where:{id:conflict.id},data:{partNumber:input.sku,active:input.active}});
    else await tx.productSku.create({data:{productId:row.id,partNumber:input.sku,normalizedPartNumber:key,active:input.active}});
    return row.id;
  });
}
export async function setProductState(client: PrismaClient, id: number, state: "active" | "inactive" | "archived") {
  const row = await client.product.findUnique({ where: { id } }); if (!row) throw new Error("Product not found.");
  await client.product.update({ where: { id }, data: { active: state === "active", archivedAt: state === "archived" ? new Date() : null } });
}
export { catalogSourceLabels } from './product-labels';
export function productCategoryChoices(client: PrismaClient) {
  return client.productCategory.findMany({ where: { OR: [{ active: true }, { products: { some: {} } }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}
export type ProductFilters = { q?: string; active?: string; category?: string; catalogSource?: string; priceException?: string; page?: string };
export function productHref(filters: ProductFilters, page?: number) {
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(filters)) if (value && key !== "page") params.set(key,value);
  if (page !== undefined) params.set("page",String(page));
  return `/products?${params}`;
}
export function productWhere(filters: ProductFilters, actor?: Actor, now = new Date()): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { archivedAt: null };
  if (filters.q?.trim()) { const q = filters.q.trim().slice(0, 100); where.OR = [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { skus: { some: { partNumber: { contains: q, mode: "insensitive" } } } }]; }
  if (filters.active === "all") delete where.archivedAt;
  if (filters.active === "active") { where.active = true; where.archivedAt = null; }
  if (filters.active === "inactive") { where.active = false; where.archivedAt = null; }
  if (filters.active === "archived") where.archivedAt = { not: null };
  if (filters.category) where.category = { code: filters.category };
  const source = Object.values(ProductCatalogSource).includes(filters.catalogSource as ProductCatalogSource)
    ? filters.catalogSource as ProductCatalogSource : null;
  if (source) where.skus = { some: { catalogSource: source } };
  if (actor && (filters.priceException === 'has' || filters.priceException === 'none')) {
    const sku: Prisma.ProductSkuWhereInput = {
      ...(source ? { catalogSource: source } : {}),
      priceExceptionLines: { some: activePriceExceptionLineWhere(actor, {}, now) },
    };
    if (filters.priceException === 'has') where.skus = { some: sku };
    else where.AND = [{ skus: { none: sku } }];
  }
  return where;
}
export async function listProducts(client: PrismaClient, filters: ProductFilters, actor?: Actor, now = new Date()) {
  const where = productWhere(filters, actor, now);
  const count = await client.product.count({ where }); const { page, pages } = pageNumber(filters.page, count);
  const products = await client.product.findMany({ where, include: { skus: { select: { id: true, partNumber: true, catalogSource: true, odmSubtype: true, odmCustomers: { select: { account: { select: { name: true } } } } } } }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20 });
  const priceExceptionsByProduct = new Map<number, number[]>();
  if (actor && products.length) {
    const selectedSource = Object.values(ProductCatalogSource).includes(filters.catalogSource as ProductCatalogSource)
      ? filters.catalogSource : null;
    const skuToProduct = new Map(products.flatMap(product => product.skus
      .filter(sku => !selectedSource || sku.catalogSource === selectedSource)
      .map(sku => [sku.id, product.id] as const)));
    if (skuToProduct.size) {
      const lineWhere = activePriceExceptionLineWhere(actor, {}, now);
      lineWhere.productSku = {
        ...(lineWhere.productSku as Prisma.ProductSkuWhereInput),
        id: { in: [...skuToProduct.keys()] },
      };
      const lines = await client.priceExceptionLine.findMany({
        where: lineWhere,
        select: { productSkuId: true, priceExceptionId: true },
      });
      const ids = new Map<number, Set<number>>();
      for (const line of lines) {
        const productId = line.productSkuId === null ? null : skuToProduct.get(line.productSkuId);
        if (productId === null || productId === undefined) continue;
        if (!ids.has(productId)) ids.set(productId, new Set());
        ids.get(productId)!.add(line.priceExceptionId);
      }
      for (const [productId, peIds] of ids) priceExceptionsByProduct.set(productId, [...peIds].sort((a, b) => a - b));
    }
  }
  return { products, count, page, pages, priceExceptionsByProduct };
}
