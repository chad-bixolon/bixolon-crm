"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseUser, saveUser } from "@/lib/users";
import { requireMutation } from "@/lib/current-user";
import { UserImpactRequired, recordUserHistory } from "@/lib/user-lifecycle";
import { assertPermission } from "@/lib/authorization";
import { assertUserAdministrationTarget } from "@/lib/users";
import { unlinkGoogleIdentity } from "@/lib/identity";
import { captureActionError } from '../../../lib/request-observability';
export type FormState = { errors: Record<string, string>; message?: string; success?: boolean; values?: Record<string, string>; impact?: { area: string; count: number }[]; confirmation?: string };
const submittedValues = (form: FormData) => Object.fromEntries(["firstName", "lastName", "email", "role", "active", "timeZone", "delegatedUserAdministrationEnabled"].map(key => [key, String(form.get(key) ?? "")]));
export async function submitUser(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  const actor = await requireMutation("users.manage");
  const parsed = parseUser(form);
  if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields.", values: submittedValues(form) };
  let userId: number;
  try { userId = await saveUser(prisma, actor, parsed.value, id ?? undefined, String(form.get("impactConfirmation") ?? "")); }
  catch (error) { if (error instanceof UserImpactRequired) return { errors: {}, message: error.message, impact: error.impact, confirmation: error.confirmation, values: submittedValues(form) }; const incident = await captureActionError(error, 'user.save', { userId: actor.id, entityType: 'User', entityId: id }); return { errors: {}, message: incident ?? (error instanceof Error && /already in use|not found|Keep at least one active|Only an Administrator|User Administration Access requires/.test(error.message) ? error.message : "User could not be saved."), values: submittedValues(form) }; }
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
  const actor = await requireMutation("users.manage");

  const confirmationEmail = String(form.get("confirmEmail") ?? "").trim();

  if (!confirmationEmail) {
    return {
      errors: { confirmEmail: "Enter the CRM user's email to confirm." },
      message: "Confirmation email is required.",
    };
  }

  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341001)`;
      const persisted = await tx.user.findUnique({ where: { id: actor.id } });
      assertPermission(persisted, 'users.manage');
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) throw new Error('User not found.');
      assertUserAdministrationTarget(persisted!, target, target);
      await unlinkGoogleIdentity(tx, userId, identityId, confirmationEmail);
      await recordUserHistory(tx, actor.id, userId, 'Identity reset');
    });
  } catch (error) {
    const incident = await captureActionError(error, 'user.google-identity-reset', { userId: actor.id, entityType: 'User', entityId: userId });
    return {
      errors: {},
      message:
        incident ?? (error instanceof Error
          ? error.message
          : "The Google sign-in link could not be reset."),
    };
  }

  revalidatePath("/administration/users");
  revalidatePath(`/administration/users/${userId}/edit`);

  return {
    errors: {},
    message:
      "Google sign-in link reset. The user's next approved Google sign-in can link the account again.",
  };
}
