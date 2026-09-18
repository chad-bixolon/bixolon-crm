import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  await requirePermission("sales.write");
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (Number.isSafeInteger(id) && id > 0) {
    const product = await prisma.product.findUnique({ where: { id }, select: {
      id: true, name: true, sku: true, active: true, archivedAt: true,
      skus: { orderBy: { partNumber: "asc" }, select: { id: true, partNumber: true, description: true, active: true, prices: { where: { tier: "STANDARD" }, select: { currencyCode: true, amount: true } } } },
    } });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ product: { ...product, skus: product.skus.map(sku => ({ ...sku, prices: sku.prices.map(price => ({ ...price, amount: price.amount.toFixed(2) })) })) } });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const where: Prisma.ProductWhereInput = { active: true, archivedAt: null };
  if (q) where.OR = [
    { name: { contains: q, mode: "insensitive" } },
    { sku: { contains: q, mode: "insensitive" } },
    { skus: { some: { partNumber: { contains: q, mode: "insensitive" } } } },
    { skus: { some: { description: { contains: q, mode: "insensitive" } } } },
  ];
  const products = await prisma.product.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], take: 25, select: { id: true, name: true, sku: true } });
  return NextResponse.json({ products });
}
