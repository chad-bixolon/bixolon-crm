import { Prisma, ProductCatalogSource, type PrismaClient } from "@prisma/client";
import { field, pageNumber, required, type Errors } from "./crm-validation";
import { normalizePartNumber } from "./product-import";
export function parseProduct(form: FormData) {
  const errors: Errors = {};
  const sku = required(form, "sku", "SKU", 100, errors);
  const name = required(form, "name", "Product name", 200, errors);
  const active = field(form, "active") !== "false";
  return { errors, value: Object.keys(errors).length ? undefined : { sku, name, active } };
}
export async function saveProduct(client: PrismaClient, input: { sku: string; name: string; active: boolean }, id?: number) {
  return client.$transaction(async tx => {
    const old = id ? await tx.product.findUnique({ where: { id } }) : null;
    if (id && !old) throw new Error("Product not found.");
    if (old?.archivedAt) throw new Error("Reactivate this product before editing it.");
    const key = normalizePartNumber(input.sku);
    const conflict = await tx.productSku.findUnique({where:{normalizedPartNumber:key}});
    if (conflict && conflict.productId !== id) throw new Error("SKU already belongs to another Product.");
    if (old && normalizePartNumber(old.sku) !== key && conflict) throw new Error("SKU already exists on this Product.");
    const row = id ? await tx.product.update({ where: { id }, data: input }) : await tx.product.create({ data: input });
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
export const catalogSourceLabels: Record<ProductCatalogSource,string> = { PRICE_LIST: "Price List", PE_LIST: "PE List", SPECIAL_SKU_LIST: "Special SKU List" };
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
  const where: Prisma.ProductWhereInput = {};
  if (filters.q?.trim()) { const q = filters.q.trim().slice(0, 100); where.OR = [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }]; }
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
  const products = await client.product.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20 });
  return { products, count, page, pages };
}
