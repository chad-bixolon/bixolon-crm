import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

const selection = { id: true, productId: true, partNumber: true, description: true, active: true,
  product: { select: { name: true, active: true, archivedAt: true } },
  prices: { select: { tier: true, currencyCode: true, amount: true } },
} as const;
function serialize(sku: { id: number; productId: number; partNumber: string; description: string | null; prices: { tier: string; currencyCode: string; amount: Prisma.Decimal }[]; product: { name: string } }) {
  return { id: sku.id, productId: sku.productId, productName: sku.product.name, partNumber: sku.partNumber, description: sku.description,
    prices: sku.prices.map(price => ({ tier: price.tier, currencyCode: price.currencyCode, amount: price.amount.toFixed(2) })) };
}

export async function GET(request: NextRequest) {
  await requirePermission("sales.write");
  const skuId = Number(request.nextUrl.searchParams.get("skuId"));
  if (Number.isSafeInteger(skuId) && skuId > 0) {
    const sku = await prisma.productSku.findUnique({ where: { id: skuId }, select: selection });
    if (!sku) return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
    return NextResponse.json({ item: serialize(sku) });
  }
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (Number.isSafeInteger(id) && id > 0) {
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true, sku: true } });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ product });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const currencyCode = (request.nextUrl.searchParams.get("currencyCode") ?? "").trim().toUpperCase().slice(0, 3);
  const where: Prisma.ProductSkuWhereInput = { active: true, product: { active: true, archivedAt: null } };
  if (q) where.OR = [
    { product: { name: { contains: q, mode: "insensitive" } } },
    { product: { sku: { contains: q, mode: "insensitive" } } },
    { partNumber: { contains: q, mode: "insensitive" } },
    { description: { contains: q, mode: "insensitive" } },
  ];
  const skus = await prisma.productSku.findMany({ where, orderBy: [{ product: { name: "asc" } }, { partNumber: "asc" }], take: 25,
    select: { ...selection, prices: { where: { currencyCode }, select: { tier: true, currencyCode: true, amount: true } } } });
  return NextResponse.json({ items: skus.map(serialize) });
}
