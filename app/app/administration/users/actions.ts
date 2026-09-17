"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseUser, saveUser } from "@/lib/users";
import { requireMutation } from "@/lib/current-user";
import { unlinkGoogleIdentity } from "@/lib/identity";
export type FormState = { errors: Record<string, string>; message?: string; success?: boolean; values?: Record<string, string> };
const submittedValues = (form: FormData) => Object.fromEntries(["firstName", "lastName", "email", "role", "active"].map(key => [key, String(form.get(key) ?? "")]));
export async function submitUser(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  const parsed = parseUser(form);
  if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields.", values: submittedValues(form) };
  let userId: number;
  try { userId = await saveUser(prisma, parsed.value, id ?? undefined); }
  catch (error) { return { errors: {}, message: error instanceof Error && /already in use|not found/.test(error.message) ? error.message : "User could not be saved.", values: submittedValues(form) }; }
  revalidatePath("/administration/users"); revalidatePath("/accounts"); revalidatePath("/opportunities");
  if (id) return { errors: {}, message: "User updated successfully.", success: true, values: submittedValues(form) };
  redirect(`/administration/users/${userId}/edit?saved=created`);
}
export async function resetGoogleIdentity(
  userId: number,
  identityId: number,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  await requireMutation("users.manage");

  const confirmationEmail = String(form.get("confirmEmail") ?? "").trim();

  if (!confirmationEmail) {
    return {
      errors: { confirmEmail: "Enter the CRM user's email to confirm." },
      message: "Confirmation email is required.",
    };
  }

  try {
    await unlinkGoogleIdentity(
      prisma,
      userId,
      identityId,
      confirmationEmail,
    );
  } catch (error) {
    return {
      errors: {},
      message:
        error instanceof Error
          ? error.message
          : "Google identity could not be unlinked.",
    };
  }

  revalidatePath("/administration/users");
  revalidatePath(`/administration/users/${userId}/edit`);

  return {
    errors: {},
    message:
      "Google identity unlinked. The user's next approved Google sign-in can link the account again.",
  };
}
