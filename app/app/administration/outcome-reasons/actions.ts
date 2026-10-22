"use server";
import { revalidatePath } from "next/cache";
import { requireMutation } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { parseOutcomeReason, saveOutcomeReason } from "@/lib/outcome-reasons";
import { Prisma } from "@prisma/client";

export type OutcomeReasonState = { message?: string; success?: boolean };
export async function submitOutcomeReason(id: number | null, _state: OutcomeReasonState, form: FormData): Promise<OutcomeReasonState> {
  const actor = await requireMutation("configuration.manage");
  try {
    await saveOutcomeReason(prisma, actor, parseOutcomeReason(form), id ?? undefined);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { message: "An Outcome Reason with this name already exists." };
    return { message: error instanceof Error ? error.message : "Could not save Outcome Reason." };
  }
  revalidatePath("/administration/outcome-reasons");
  revalidatePath("/opportunities/new");
  revalidatePath("/reports/new");
  return { success: true, message: id ? "Outcome Reason updated." : "Outcome Reason added." };
}
