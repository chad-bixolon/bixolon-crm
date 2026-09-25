import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "./authorization";
import { priceExceptionVisibilityWhere } from "./price-exception-visibility";

type Db = PrismaClient | Prisma.TransactionClient;
export type PriceExceptionCandidate = {
  lineId: number;
  priceExceptionId: number;
  peCode: string | null;
  unitPrice: string;
  currencyCode: string;
  moq: string | null;
  moqRaw: string | null;
  expirationDate: string | null;
  comments: string | null;
  parties: { role: string; accountId: number | null; accountName: string | null; sourceName: string | null; matchesOpportunity: boolean }[];
  matchedRoles: string[];
};

export type MoqEligibility = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
export function moqEligibility(opportunityQuantity: number, normalizedMoq: string | null): MoqEligibility {
  if (!Number.isSafeInteger(opportunityQuantity) || opportunityQuantity <= 0 || !normalizedMoq || !/^\d+(?:\.\d+)?$/.test(normalizedMoq)) return "UNKNOWN";
  try {
    const moq = new Prisma.Decimal(normalizedMoq);
    if (!moq.isPositive()) return "UNKNOWN";
    return new Prisma.Decimal(opportunityQuantity).gte(moq) ? "ELIGIBLE" : "INELIGIBLE";
  } catch {
    return "UNKNOWN";
  }
}

export function priceExceptionEligibilityWhere(skuId: number, currencyCode: string, today = new Date()): Prisma.PriceExceptionLineWhereInput {
  const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return {
    productSkuId: skuId,
    productSku: { active: true, product: { active: true, archivedAt: null } },
    approvedUnitPrice: { not: null },
    currencyCode,
    priceException: {
      status: "ACTIVE",
      archivedAt: null,
      AND: [{ OR: [{ expirationDate: null }, { expirationDate: { gte: cutoff } }] }],
    },
  };
}

function numericSearch(q: string): Prisma.PriceExceptionLineWhereInput[] {
  if (!/^\d+(?:\.\d{1,3})?$/.test(q)) return [];
  try {
    return [{ approvedUnitPrice: new Prisma.Decimal(q) }, { sourceQuantity: new Prisma.Decimal(q) }];
  } catch {
    return [];
  }
}

export async function findPriceExceptionCandidates(
  db: Db,
  input: { skuId: number; currencyCode: string; opportunityAccountIds: number[]; relatedOnly: boolean; query?: string; today?: Date; actor?: Actor },
): Promise<PriceExceptionCandidate[]> {
  const accountIds = [...new Set(input.opportunityAccountIds)];
  const q = input.query?.trim().slice(0, 100) ?? "";
  const where: Prisma.PriceExceptionLineWhereInput = priceExceptionEligibilityWhere(input.skuId, input.currencyCode, input.today);
  if (input.actor) {
    const parent = where.priceException as Prisma.PriceExceptionWhereInput;
    where.priceException = { AND: [parent, priceExceptionVisibilityWhere(input.actor)] };
  }
  if (input.relatedOnly) {
    if (!accountIds.length) return [];
    const parent = where.priceException as Prisma.PriceExceptionWhereInput;
    where.priceException = { ...parent, AND: [
      ...((parent.AND as Prisma.PriceExceptionWhereInput[]) ?? []),
      { OR: [
          { distributorAccount: { id: { in: accountIds }, archivedAt: null, status: 'ACTIVE' } },
          { varAccount: { id: { in: accountIds }, archivedAt: null, status: 'ACTIVE' } },
          { endUserAccount: { id: { in: accountIds }, archivedAt: null, status: 'ACTIVE' } },
      ] },
    ] };
  }
  if (q) {
    where.AND = [{ OR: [
      { sourceQuantityRaw: { contains: q, mode: "insensitive" } },
      { comments: { contains: q, mode: "insensitive" } },
      ...numericSearch(q),
      { priceException: { OR: [
        { peCode: { contains: q, mode: "insensitive" } },
        { distributorSourceName: { contains: q, mode: "insensitive" } },
        { varSourceName: { contains: q, mode: "insensitive" } },
        { endUserSourceName: { contains: q, mode: "insensitive" } },
        { distributorAccount: { name: { contains: q, mode: "insensitive" } } },
        { varAccount: { name: { contains: q, mode: "insensitive" } } },
        { endUserAccount: { name: { contains: q, mode: "insensitive" } } },
      ] } },
    ] }];
  }
  const rows = await db.priceExceptionLine.findMany({
    where,
    orderBy: [{ priceException: { expirationDate: "desc" } }, { priceExceptionId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    take: 100,
    include: { priceException: { include: {
      distributorAccount: { select: { id: true, name: true } },
      varAccount: { select: { id: true, name: true } },
      endUserAccount: { select: { id: true, name: true } },
    } } },
  });
  const participantIds = new Set(accountIds);
  return rows.map((line) => {
    const pe = line.priceException;
    const parties = [
      { role: "Distributor/OEM", account: pe.distributorAccount, sourceName: pe.distributorSourceName },
      { role: "VAR/ISV", account: pe.varAccount, sourceName: pe.varSourceName },
      { role: "End User", account: pe.endUserAccount, sourceName: pe.endUserSourceName },
    ].filter(party => party.account || party.sourceName).map(party => ({
      role: party.role,
      accountId: party.account?.id ?? null,
      accountName: party.account?.name ?? null,
      sourceName: party.sourceName,
      matchesOpportunity: !!party.account && participantIds.has(party.account.id),
    }));
    return {
      lineId: line.id,
      priceExceptionId: pe.id,
      peCode: pe.peCode,
      unitPrice: line.approvedUnitPrice!.toFixed(2),
      currencyCode: line.currencyCode,
      moq: line.sourceQuantity?.toString() ?? null,
      moqRaw: line.sourceQuantityRaw,
      expirationDate: pe.expirationDate?.toISOString().slice(0, 10) ?? null,
      comments: line.comments ?? pe.sourceDescription,
      parties,
      matchedRoles: parties.filter(party => party.matchesOpportunity).map(party => party.role),
    };
  });
}

export function priceExceptionSnapshot(line: {
  id: number;
  sourceQuantity: Prisma.Decimal | null;
  sourceQuantityRaw: string | null;
  sourceUnit: string | null;
  approvedUnitPrice: Prisma.Decimal | null;
  currencyCode: string;
  priceException: { peCode: string | null };
}) {
  // The legacy Qty column is MOQ. Snapshot the normalized numeric value used
  // for commercial eligibility; raw malformed values remain on the PE line.
  const normalizedMoq = line.sourceQuantity?.toString() ?? null;
  return {
    priceExceptionLineId: line.id,
    priceExceptionCode: line.priceException.peCode,
    priceExceptionUnitPrice: line.approvedUnitPrice,
    priceExceptionCurrencyCode: line.currencyCode,
    priceExceptionSourceQty: normalizedMoq,
  };
}
