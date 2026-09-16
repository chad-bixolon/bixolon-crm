import { Prisma, type PrismaClient } from "@prisma/client";
import { field, pageNumber, required, type Errors } from "./crm-validation";
export function parseProduct(form: FormData) {
  const errors: Errors = {};
  const sku = required(form, "sku", "SKU", 100, errors);
  const name = required(form, "name", "Product name", 200, errors);
  const active = field(form, "active") !== "false";
  return { errors, value: Object.keys(errors).length ? undefined : { sku, name, active } };
}
export async function saveProduct(client: PrismaClient, input: { sku: string; name: string; active: boolean }, id?: number) {
  if (id) { const row = await client.product.findUnique({ where: { id } }); if (!row) throw new Error("Product not found."); if (row.archivedAt) throw new Error("Reactivate this product before editing it."); }
  const row = id ? await client.product.update({ where: { id }, data: input }) : await client.product.create({ data: input }); return row.id;
}
export async function setProductState(client: PrismaClient, id: number, state: "active" | "inactive" | "archived") {
  const row = await client.product.findUnique({ where: { id } }); if (!row) throw new Error("Product not found.");
  await client.product.update({ where: { id }, data: { active: state === "active", archivedAt: state === "archived" ? new Date() : null } });
}
export type ProductFilters = { q?: string; active?: string; page?: string };
export async function listProducts(client: PrismaClient, filters: ProductFilters) {
  const where: Prisma.ProductWhereInput = {};
  if (filters.q?.trim()) { const q = filters.q.trim().slice(0, 100); where.OR = [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }]; }
  if (filters.active === "active") { where.active = true; where.archivedAt = null; }
  if (filters.active === "inactive") { where.active = false; where.archivedAt = null; }
  if (filters.active === "archived") where.archivedAt = { not: null };
  const count = await client.product.count({ where }); const { page, pages } = pageNumber(filters.page, count);
  const products = await client.product.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20 });
  return { products, count, page, pages };
}
