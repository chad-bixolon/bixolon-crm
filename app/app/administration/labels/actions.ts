"use server";
import { revalidatePath } from "next/cache";
import { requireMutation } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { restoreLabel, saveLabel } from "@/lib/configuration";
export async function submitLabel(key: string, action: "save" | "restore", _state: { message: string; success?: boolean }, form: FormData) {
  const actor = await requireMutation("users.manage");
  try {
    if (action === "restore") await restoreLabel(prisma, key, actor.id);
    else await saveLabel(prisma, key, String(form.get("displayLabel") ?? ""), actor.id);
  } catch (error) { return { message: error instanceof Error ? error.message : "Could not save label.", success: false }; }
  revalidatePath("/", "layout");
  return { message: action === "restore" ? "Default restored." : "Label saved.", success: true };
}
