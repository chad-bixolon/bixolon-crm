"use server";
import { revalidatePath } from "next/cache";
import { requireMutation } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { parseCompetitor, saveCompetitor } from "@/lib/competitors";
import { Prisma } from "@prisma/client";

export type CompetitorState = { message?: string; success?: boolean };
export async function submitCompetitor(id: number | null, _state: CompetitorState, form: FormData): Promise<CompetitorState> {
  await requireMutation("users.manage");
  try {
    await saveCompetitor(prisma, parseCompetitor(form), id ?? undefined);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { message: "A competitor with this name already exists." };
    return { message: error instanceof Error ? error.message : "Could not save competitor." };
  }
  revalidatePath("/administration/competitors");
  revalidatePath("/opportunities/new");
  revalidatePath("/reports/new");
  return { success: true, message: id ? "Competitor updated." : "Competitor added." };
}
