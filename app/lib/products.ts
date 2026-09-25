import { Prisma, ProductCatalogSource, type PrismaClient } from "@prisma/client";
import { field, pageNumber, required, type Errors } from "./crm-validation";
import { normalizePartNumber } from "./product-import";
import { DuplicateSkuError, saveSkuMetadataInTransaction, type SkuMetadataInput } from "./odm-skus";
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
export type ProductFilters = { q?: string; active?: string; category?: string; catalogSource?: string; page?: string };
export function productHref(filters: ProductFilters, page?: number) {
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(filters)) if (value && key !== "page") params.set(key,value);
  if (page !== undefined) params.set("page",String(page));
  return `/products?${params}`;
}
export function productWhere(filters: ProductFilters): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { archivedAt: null };
  if (filters.q?.trim()) { const q = filters.q.trim().slice(0, 100); where.OR = [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { skus: { some: { partNumber: { contains: q, mode: "insensitive" } } } }]; }
  if (filters.active === "all") delete where.archivedAt;
  if (filters.active === "active") { where.active = true; where.archivedAt = null; }
  if (filters.active === "inactive") { where.active = false; where.archivedAt = null; }
  if (filters.active === "archived") where.archivedAt = { not: null };
  if (filters.category) where.category = { code: filters.category };
  if (Object.values(ProductCatalogSource).includes(filters.catalogSource as ProductCatalogSource)) where.skus = { some: { catalogSource: filters.catalogSource as ProductCatalogSource } };
  return where;
}
export async function listProducts(client: PrismaClient, filters: ProductFilters) {
  const where = productWhere(filters);
  const count = await client.product.count({ where }); const { page, pages } = pageNumber(filters.page, count);
  const products = await client.product.findMany({ where, include: { skus: { select: { id: true, partNumber: true, catalogSource: true, odmSubtype: true, odmCustomers: { select: { account: { select: { name: true } } } } } } }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20 });
  return { products, count, page, pages };
}
