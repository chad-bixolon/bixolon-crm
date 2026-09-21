import type { ForecastCategory, OpportunityPartyRole, OpportunityProductPriceSource, ProductPriceTier } from "@prisma/client";

export type ParticipantDraft = { accountId: number; roles: OpportunityPartyRole[] };
export type LineDraft = { id: number; productId: number; skuId?: number | null; quantity: string; price: string; priceSource: OpportunityProductPriceSource; catalogPriceTier: ProductPriceTier | null; priceExceptionLineId: number | null; priceExceptionCode: string | null; priceExceptionUnitPrice: string | null; priceExceptionCurrencyCode: string | null; priceExceptionSourceQty: string | null; priceExceptionAccountIds: number[] };
export type OpportunityDraft = {
  name: string; description: string; ownerId: string; stageId: string; expectedCloseDate: string;
  probability: string; forecastCategory: ForecastCategory | ""; currencyCode: string; projectIds: number[];
  participants: ParticipantDraft[]; lines: LineDraft[];
};
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const forecastCategories = ["OMITTED", "PIPELINE", "BEST_CASE", "COMMIT", "CLOSED"];
const partyRoles = ["END_USER", "VAR_RESELLER", "DISTRIBUTOR", "ISV_PARTNER", "OEM", "OTHER", "MEDIA_PARTNER", "SERVICE_PARTNER"];
const priceSources = ["MANUAL", "CATALOG", "PRICE_EXCEPTION"];
const catalogTiers = ["STANDARD", "MSRP", "RESELLER", "DISTRIBUTOR"];
const isId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isLineId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function draftKey(id?: number) { return `opportunity-draft:${id ?? "new"}`; }
export function addParticipant(draft: OpportunityDraft, accountId: number): OpportunityDraft {
  if (!accountId || draft.participants.some((p) => p.accountId === accountId)) return draft;
  return { ...draft, participants: [...draft.participants, { accountId, roles: [] }] };
}
export function removeParticipant(draft: OpportunityDraft, accountId: number): OpportunityDraft {
  return { ...draft, participants: draft.participants.filter((p) => p.accountId !== accountId) };
}
export function setParticipantRoles(draft: OpportunityDraft, accountId: number, roles: OpportunityPartyRole[]): OpportunityDraft {
  return { ...draft, participants: draft.participants.map((p) => p.accountId === accountId ? { ...p, roles } : p) };
}
export function readDraft(raw: string | null, fallback: OpportunityDraft): OpportunityDraft {
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return fallback;
    const strings = ["name", "description", "ownerId", "stageId", "expectedCloseDate", "probability", "currencyCode"];
    if (!strings.every((key) => typeof value[key] === "string")) return fallback;
    if (typeof value.forecastCategory !== "string" || (value.forecastCategory !== "" && !forecastCategories.includes(value.forecastCategory))) return fallback;
    if (value.projectIds === undefined && typeof value.projectId === "string") {
      if (value.projectId !== "" && !/^[1-9]\d*$/.test(value.projectId)) return fallback;
      value.projectIds = value.projectId ? [Number(value.projectId)] : [];
      delete value.projectId;
    }
    if (!Array.isArray(value.projectIds) || !value.projectIds.every(isId) || new Set(value.projectIds).size !== value.projectIds.length) return fallback;
    if (!Array.isArray(value.participants) || !value.participants.every((p: unknown) => isRecord(p) && isId(p.accountId) && Array.isArray(p.roles) && p.roles.every((role: unknown) => typeof role === "string" && partyRoles.includes(role)))) return fallback;
    if (!Array.isArray(value.lines) || !value.lines.every((line: unknown) => isRecord(line) && isLineId(line.id) && isLineId(line.productId) && (line.skuId === undefined || line.skuId === null || isLineId(line.skuId)) && typeof line.quantity === "string" && typeof line.price === "string")) return fallback;
    for (const line of value.lines as Record<string, unknown>[]) {
      // Drafts saved before Stage 5 remain usable; the form supplies manual provenance when submitted.
      if (line.priceSource === undefined) continue;
      if (typeof line.priceSource !== "string" || !priceSources.includes(line.priceSource)) return fallback;
      if (line.catalogPriceTier !== null && (typeof line.catalogPriceTier !== "string" || !catalogTiers.includes(line.catalogPriceTier))) return fallback;
      if (line.priceExceptionLineId !== null && !isId(line.priceExceptionLineId)) return fallback;
      if (!Array.isArray(line.priceExceptionAccountIds) || !line.priceExceptionAccountIds.every(isId)) return fallback;
      for (const key of ["priceExceptionCode", "priceExceptionUnitPrice", "priceExceptionCurrencyCode", "priceExceptionSourceQty"]) if (line[key] !== null && typeof line[key] !== "string") return fallback;
    }
    return value as OpportunityDraft;
  } catch { return fallback; }
}
export function restoreDraft(storage: DraftStorage, key: string, fallback: OpportunityDraft): OpportunityDraft {
  try { return readDraft(storage.getItem(key), fallback); } catch { return fallback; }
}
export function persistDraft(storage: DraftStorage, key: string, draft: OpportunityDraft, hydratedKey: string | null): boolean {
  if (hydratedKey !== key) return false;
  try { storage.setItem(key, JSON.stringify(draft)); return true; } catch { return false; }
}
export function clearDraft(storage: DraftStorage, key: string): void {
  try { storage.removeItem(key); } catch { /* Storage can be unavailable in private browsing. */ }
}
