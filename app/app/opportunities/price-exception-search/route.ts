import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/current-user";
import { findPriceExceptionCandidates } from "@/lib/opportunity-price-exceptions";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const actor = await requirePermission("sales.write");
  const skuId = Number(request.nextUrl.searchParams.get("skuId"));
  const currencyCode = (request.nextUrl.searchParams.get("currencyCode") ?? "").trim().toUpperCase();
  const relatedOnly = request.nextUrl.searchParams.get("scope") !== "all";
  const accountIds = (request.nextUrl.searchParams.get("accountIds") ?? "").split(",").filter(Boolean).map(Number);
  if (!Number.isSafeInteger(skuId) || skuId <= 0 || !/^[A-Z]{3}$/.test(currencyCode) || accountIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return NextResponse.json({ error: "Invalid price exception search." }, { status: 400 });
  }
  const options = await findPriceExceptionCandidates(prisma, {
    skuId,
    currencyCode,
    opportunityAccountIds: accountIds,
    relatedOnly,
    query: relatedOnly ? undefined : request.nextUrl.searchParams.get("q") ?? "",
    actor,
  });
  return NextResponse.json({ options });
}
