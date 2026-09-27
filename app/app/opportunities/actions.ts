"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseOpportunity, saveOpportunity, setOpportunityArchived } from "@/lib/opportunities";
import { friendlyError } from "@/lib/crm-validation";
import { requireMutation } from '@/lib/current-user';
import { saveFeedbackPath } from '@/lib/save-feedback';
import { opportunitySaveReview, type DuplicateMatch, type MissingForecastField } from '@/lib/sales-readiness';
export type FormState = { errors: Record<string, string>; message?: string; redirectTo?: string; matches?: DuplicateMatch[]; missing?: MissingForecastField[]; reviewToken?: string };
export async function submitOpportunity(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  const actor = await requireMutation('sales.write');
  const parsed = parseOpportunity(form); if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields." };
  const review = await opportunitySaveReview(prisma, parsed.value, form, !id, actor.role === 'SALES' ? actor.id : undefined); if (review) return { errors: {}, ...review };
  let opportunityId: number;
  try { opportunityId = await saveOpportunity(prisma, parsed.value, id ?? undefined, actor); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Opportunity could not be saved. Check participant and product references.") }; }
  revalidatePath("/opportunities"); revalidatePath("/accounts"); if (id) revalidatePath(`/opportunities/${id}`);
  return { errors: {}, redirectTo: saveFeedbackPath(`/opportunities/${opportunityId}`, id ? 'updated' : 'created') };
}
export async function changeOpportunityArchive(id: number, archive: boolean, _old: FormState): Promise<FormState> {
  const actor = await requireMutation('sales.write');
  void _old;
  try { await setOpportunityArchived(prisma, id, archive, actor); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Opportunity status could not be changed.") }; }
  revalidatePath("/opportunities"); revalidatePath(`/opportunities/${id}`); revalidatePath("/accounts");
  return { errors: {}, message: archive ? "Opportunity archived." : "Opportunity reactivated." };
}
