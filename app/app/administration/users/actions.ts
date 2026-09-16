"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseUser, saveUser } from "@/lib/users";
export type FormState = { errors: Record<string, string>; message?: string };
export async function submitUser(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  const parsed = parseUser(form);
  if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields." };
  let userId: number;
  try { userId = await saveUser(prisma, parsed.value, id ?? undefined); }
  catch (error) { return { errors: {}, message: error instanceof Error && /already in use|not found/.test(error.message) ? error.message : "User could not be saved." }; }
  revalidatePath("/administration/users"); revalidatePath("/accounts"); revalidatePath("/opportunities");
  redirect(`/administration/users/${userId}/edit`);
}
