"use server";
import { prisma } from "@/lib/prisma";
import { checkAccountReferences, saveAccount, setAccountArchived } from "@/lib/accounts";
import { parseAccountForm } from "@/lib/account-validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMutation } from "@/lib/current-user";

export type FormState = { errors: Record<string, string>; message?: string };
export async function submitAccount(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  const actor = await requireMutation('accounts.write');
  const result = parseAccountForm(form);
  if (!result.value) return { errors: result.errors, message: "Please correct the highlighted fields." };
  const references = await checkAccountReferences(prisma, result.value, id ?? undefined);
  if (Object.keys(references).length) return { errors: references, message: "Please correct the highlighted fields." };
  let accountId: number;
  try { accountId = await saveAccount(prisma, result.value, id ?? undefined, actor.id); }
  catch (error) { return { errors: {}, message: error instanceof Error && /Reactivate|not found/.test(error.message) ? error.message : "Account could not be saved. Please try again." }; }
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  redirect(`/accounts/${accountId}`);
}
export async function changeArchiveState(id: number, archive: boolean, _state: FormState): Promise<FormState> {
  void _state;
  try { await setAccountArchived(prisma, id, archive); }
  catch (error) { return { errors: {}, message: error instanceof Error ? error.message : "Could not update account status." }; }
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  return { errors: {}, message: archive ? "Account archived." : "Account reactivated." };
}
