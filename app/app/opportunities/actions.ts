"use server";
import { assertModuleEnabled, getModuleAvailability } from '@/lib/module-availability';
import { requireEditToken, isRecordChanged, recordChangedMessage } from '../../lib/stale-edit';
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseOpportunity, saveOpportunity, setOpportunityArchived } from "@/lib/opportunities";
import { friendlyError } from "@/lib/crm-validation";
import { requireMutation } from '@/lib/current-user';
import { saveFeedbackPath } from '@/lib/save-feedback';
import { opportunitySaveReview, type DuplicateMatch, type MissingForecastField } from '@/lib/sales-readiness';
export type FormState = { errors: Record<string, string>; message?: string; redirectTo?: string; matches?: DuplicateMatch[]; missing?: MissingForecastField[]; reviewToken?: string; recordChanged?: boolean };
export async function submitOpportunity(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  await assertModuleEnabled('OPPORTUNITIES');
  const actor = await requireMutation('sales.write');
  const availability = await getModuleAvailability();
  const productsEnabled = availability.effective.has('PRODUCTS');
  const projectsEnabled = availability.effective.has('PROJECTS');
  if (!productsEnabled && ['productId', 'skuId', 'lineId', 'quantity', 'price', 'priceSource', 'priceExceptionLineId'].some(key => form.has(key)))
    return { errors: { lines: 'Products are unavailable in this deployment.' } };
  if (!projectsEnabled && form.has('projectIds')) return { errors: { projectIds: 'Projects are unavailable in this deployment.' } };
  const parsed = parseOpportunity(form); if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields." };
  if (!availability.effective.has('PRICE_EXCEPTIONS') && parsed.value.lines.some(line => line.priceSource === 'PRICE_EXCEPTION')) {
    const old = id ? await prisma.opportunityProduct.findMany({ where: { opportunityId: id, archivedAt: null, priceSource: 'PRICE_EXCEPTION' } }) : [];
    const unchanged = parsed.value.lines.filter(line => line.priceSource === 'PRICE_EXCEPTION').every(line => old.some(previous => previous.id === line.id && previous.productId === line.productId && previous.skuId === (line.skuId ?? null) && previous.quantity === line.quantity && previous.estimatedUnitPrice.equals(line.price) && previous.priceExceptionLineId === line.priceExceptionLineId));
    if (!unchanged) return { errors: { lines: 'Price Exceptions are unavailable in this deployment.' } };
  }
  const review = await opportunitySaveReview(prisma, parsed.value, form, !id, actor.role === 'SALES' ? actor.id : undefined); if (review) return { errors: {}, ...review };
  let opportunityId: number;
  try { opportunityId = await saveOpportunity(prisma, parsed.value, id ?? undefined, actor, id ? requireEditToken(form) : undefined, { products: !productsEnabled, projects: !projectsEnabled }); }
  catch (error) { if (isRecordChanged(error)) return { errors: {}, recordChanged: true, message: recordChangedMessage }; return { errors: {}, message: friendlyError(error, "Opportunity could not be saved. Check participant and product references.") }; }
  revalidatePath("/opportunities"); revalidatePath("/accounts"); if (id) revalidatePath(`/opportunities/${id}`);
  return { errors: {}, redirectTo: saveFeedbackPath(`/opportunities/${opportunityId}`, id ? 'updated' : 'created') };
}
export async function changeOpportunityArchive(id: number, archive: boolean, _old: FormState): Promise<FormState> {
  await assertModuleEnabled('OPPORTUNITIES');
  const actor = await requireMutation('sales.write');
  void _old;
  try { await setOpportunityArchived(prisma, id, archive, actor); }
  catch (error) { if (isRecordChanged(error)) return { errors: {}, recordChanged: true, message: recordChangedMessage }; return { errors: {}, message: friendlyError(error, "Opportunity status could not be changed.") }; }
  revalidatePath("/opportunities"); revalidatePath(`/opportunities/${id}`); revalidatePath("/accounts");
  return { errors: {}, message: archive ? "Opportunity archived." : "Opportunity reactivated." };
}
