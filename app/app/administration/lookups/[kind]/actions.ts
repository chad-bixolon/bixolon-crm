"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireMutation } from "@/lib/current-user";
import { lookupKind, parseLookup, saveLookup } from "@/lib/lookups";

export type LookupState = { errors: Record<string, string>; message?: string; success?: boolean };
export async function submitLookup(kind: string, editing: boolean, _state: LookupState, form: FormData): Promise<LookupState> {
  await requireMutation("users.manage");
  if (!lookupKind(kind)) return { errors: {}, message: "Unknown lookup type." };
  const parsed = parseLookup(form, editing);
  if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields." };
  try { await saveLookup(prisma, kind, parsed.value, editing); }
  catch { return { errors: {}, message: editing ? "Could not update value. Check that the name is unique." : "Could not create value. Code and name must be unique." }; }
  revalidatePath(`/administration/lookups/${kind}`);
  revalidatePath("/accounts");
  revalidatePath("/accounts/new");
  if (kind === "product-categories") revalidatePath("/products");
  return { errors: {}, message: editing ? "Value updated." : "Value created.", success: true };
}
