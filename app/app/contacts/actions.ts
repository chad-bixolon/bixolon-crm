"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseContact, saveContact, setContactState } from "@/lib/contacts";
import { friendlyError } from "@/lib/crm-validation";
export type FormState = { errors: Record<string, string>; message?: string };
export async function submitContact(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  const parsed = parseContact(form); if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields." };
  let contactId: number;
  try { contactId = await saveContact(prisma, parsed.value, id ?? undefined); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Contact could not be saved. Check whether another contact is primary for this account.") }; }
  revalidatePath("/contacts"); revalidatePath(`/accounts/${parsed.value.accountId}`); if (id) revalidatePath(`/contacts/${id}`);
  redirect(`/contacts/${contactId}`);
}
export async function changeContactState(id: number, state: "active" | "inactive" | "archived", _old: FormState): Promise<FormState> {
  void _old;
  try { await setContactState(prisma, id, state); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Contact status could not be changed.") }; }
  revalidatePath("/contacts"); revalidatePath(`/contacts/${id}`); revalidatePath("/accounts");
  return { errors: {}, message: `Contact ${state === "active" ? "activated" : state === "inactive" ? "deactivated" : "archived"}.` };
}
