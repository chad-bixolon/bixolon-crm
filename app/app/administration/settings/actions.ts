"use server";
import { revalidatePath } from "next/cache";
import { requireMutation } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { parseSetting } from "@/lib/configuration";
export async function submitSetting(key: string, _state: { message: string; success?: boolean }, form: FormData) {
  const actor = await requireMutation("users.manage");
  try {
    const value = parseSetting(key, String(form.get("value") ?? ""));
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value, changedById: actor.id }, update: { value, changedById: actor.id, changedAt: new Date() } });
  } catch (error) { return { message: error instanceof Error ? error.message : "Could not save setting.", success: false }; }
  revalidatePath("/administration/settings");
  return { message: "Setting saved.", success: true };
}
