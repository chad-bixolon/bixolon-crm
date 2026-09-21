"use server";
import { revalidatePath } from "next/cache";
import { requireMutation } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { parseStage, saveStage } from "@/lib/sales-stage-admin";
export async function submitStage(id: number | null, _state: { message: string; success?: boolean }, form: FormData) {
  await requireMutation("users.manage");
  try { await saveStage(prisma, id, parseStage(form)); }
  catch (error) { return { message: error instanceof Error && !error.message.includes("Unique constraint") ? error.message : "Stage name must be unique.", success: false }; }
  revalidatePath("/administration/sales-stages");
  revalidatePath("/opportunities");
  revalidatePath("/pipeline");
  revalidatePath("/reports/forecast");
  return { message: "Stage saved.", success: true };
}
