import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/current-user";
import { findPriceExceptionCandidates } from "@/lib/opportunity-price-exceptions";
import { prisma } from "@/lib/prisma";
import { OpportunityPartyRole } from '@prisma/client';

export async function GET(request: NextRequest) {
  const actor = await requirePermission("sales.write");
  const skuId = Number(request.nextUrl.searchParams.get("skuId"));
  const currencyCode = (request.nextUrl.searchParams.get("currencyCode") ?? "").trim().toUpperCase();
  const relatedOnly = request.nextUrl.searchParams.get("scope") !== "all";
  let participants: { accountId: number; roles: OpportunityPartyRole[] }[];
  try {
    const raw: unknown = JSON.parse(request.nextUrl.searchParams.get('participants') ?? '[]');
    if (!Array.isArray(raw) || raw.length > 100 || !raw.every(item => item && typeof item === 'object' && Number.isSafeInteger(item.accountId) && item.accountId > 0 && Array.isArray(item.roles) && item.roles.every((role: unknown) => Object.values(OpportunityPartyRole).includes(role as OpportunityPartyRole)))) throw new Error('Invalid participants');
    participants = raw;
  } catch {
    return NextResponse.json({ error: 'Invalid price exception search.' }, { status: 400 });
  }
  if (!Number.isSafeInteger(skuId) || skuId <= 0 || !/^[A-Z]{3}$/.test(currencyCode)) {
    return NextResponse.json({ error: "Invalid price exception search." }, { status: 400 });
  }
  const options = await findPriceExceptionCandidates(prisma, {
    skuId,
    currencyCode,
    opportunityParticipants: participants,
    relatedOnly,
    query: relatedOnly ? undefined : request.nextUrl.searchParams.get("q") ?? "",
    actor,
  });
  return NextResponse.json({ options });
}
