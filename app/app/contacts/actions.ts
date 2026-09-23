"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseContact, saveContact, setContactState } from "@/lib/contacts";
import { friendlyError } from "@/lib/crm-validation";
import { requireMutation } from "@/lib/current-user";
export type FormState = { errors: Record<string, string>; message?: string; values?: Record<string, string> };
function retainedValues(form: FormData) { const values=Object.fromEntries([...form.entries()].filter((entry): entry is [string,string] => typeof entry[1] === "string")); values.isPrimary=form.has("isPrimary")?"true":"false"; return values; }
export async function submitContact(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  const actor = await requireMutation("contacts.write");
  const values=retainedValues(form);
  const parsed = parseContact(form); if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields.", values };
  let contactId: number;
  const previous = id ? await prisma.contact.findUnique({ where: { id }, select: { accountId: true } }) : null;
  try { contactId = await saveContact(prisma, parsed.value, id ?? undefined, actor); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Contact could not be saved. Check whether another contact is primary for this account."), values }; }
  revalidatePath("/contacts");
  for (const accountId of new Set([previous?.accountId, parsed.value.accountId])) if (accountId) revalidatePath(`/accounts/${accountId}`);
  if (id) revalidatePath(`/contacts/${id}`);
  redirect(`/contacts/${contactId}`);
}
export async function changeContactState(id: number, state: "active" | "inactive" | "archived", _old: FormState): Promise<FormState> {
  void _old;
  await requireMutation("contacts.write");
  try { await setContactState(prisma, id, state); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Contact status could not be changed.") }; }
  revalidatePath("/contacts"); revalidatePath(`/contacts/${id}`); revalidatePath("/accounts");
  return { errors: {}, message: `Contact ${state === "active" ? "activated" : state === "inactive" ? "deactivated" : "archived"}.` };
}
