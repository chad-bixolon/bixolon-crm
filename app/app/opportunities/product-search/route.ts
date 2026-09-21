import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { searchCatalog } from "@/lib/catalog-search";

const selection = { id: true, productId: true, partNumber: true, description: true, active: true, catalogSource: true, odmCustomerAccountId: true, odmDescription: true, odmCustomerAccount: { select: { name: true } },
  product: { select: { name: true, categoryId: true } },
  prices: { select: { tier: true, currencyCode: true, amount: true } },
} as const;
function serialize(sku: { id: number; productId: number; partNumber: string; description: string | null; catalogSource: string | null; odmCustomerAccountId: number | null; odmDescription: string | null; odmCustomerAccount: { name: string } | null; prices: { tier: string; currencyCode: string; amount: Prisma.Decimal }[]; product: { name: string; categoryId: number | null } }) {
  return { id: sku.id, productId: sku.productId, productName: sku.product.name, categoryId: sku.product.categoryId, partNumber: sku.partNumber, description: sku.description, catalogSource: sku.catalogSource, odmCustomerAccountId: sku.odmCustomerAccountId, odmCustomerName: sku.odmCustomerAccount?.name ?? null, odmDescription: sku.odmDescription,
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
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true, sku: true, categoryId: true } });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ product });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const currencyCode = (request.nextUrl.searchParams.get("currencyCode") ?? "").trim().toUpperCase().slice(0, 3);
  const rawCategory = request.nextUrl.searchParams.get("categoryId");
  const categoryId = rawCategory ? Number(rawCategory) : null;
  if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId <= 0)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  return NextResponse.json({ items: await searchCatalog(prisma, q, categoryId, currencyCode) });
}
