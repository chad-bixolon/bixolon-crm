import { ForecastCategory, OpportunityPartyRole } from "@prisma/client";
import { defaultLabels, type LabelMap } from "./configuration";

export type Errors = Record<string, string>;
export function field(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
export function required(form: FormData, key: string, label: string, limit: number, errors: Errors) {
  const value = field(form, key);
  if (!value) errors[key] = `${label} is required.`;
  else if (value.length > limit) errors[key] = `Use ${limit} characters or fewer.`;
  return value;
}
export function optional(form: FormData, key: string, limit: number, errors: Errors) {
  const value = field(form, key);
  if (value.length > limit) errors[key] = `Use ${limit} characters or fewer.`;
  return value || null;
}
export function positiveId(value: string) { const id = Number(value); return /^\d+$/.test(value) && Number.isSafeInteger(id) && id > 0 ? id : null; }
export function pageNumber(raw: string | undefined, count: number, size = 20) {
  const pages = Math.max(1, Math.ceil(count / size));
  const requested = Number(raw);
  return { page: Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pages) : 1, pages };
}
export function phone(value: string | null, key: string, errors: Errors) {
  if (value && !/^[+()\d .-]{5,50}$/.test(value)) errors[key] = "Enter a valid phone number.";
}
export const partyLabels: Record<OpportunityPartyRole, string> = {
  END_USER: defaultLabels.END_USER, VAR_RESELLER: defaultLabels.VAR, DISTRIBUTOR: defaultLabels.DISTRIBUTOR, ISV_PARTNER: defaultLabels.ISV, OEM: defaultLabels.OEM, OTHER: "Other", MEDIA_PARTNER: defaultLabels.MEDIA_PARTNER,
};
export function opportunityPartyLabels(labels: LabelMap): Record<OpportunityPartyRole, string> { return { END_USER: labels.END_USER, VAR_RESELLER: labels.VAR, DISTRIBUTOR: labels.DISTRIBUTOR, ISV_PARTNER: labels.ISV, OEM: labels.OEM, OTHER: "Other", MEDIA_PARTNER: labels.MEDIA_PARTNER }; }
export const forecastLabels: Record<ForecastCategory, string> = {
  OMITTED: "Omitted", PIPELINE: "Pipeline", BEST_CASE: "Best Case", COMMIT: "Commit", CLOSED: "Closed",
};
export function friendlyError(error: unknown, fallback: string) {
  if (error instanceof Error && /not found|Reactivate|already|linked|active account|active product|available|primary|MOQ/i.test(error.message)) return error.message;
  return fallback;
}
