"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseProduct, saveProduct, setProductState } from "@/lib/products";
import { friendlyError } from "@/lib/crm-validation";
export type FormState = { errors: Record<string, string>; message?: string };
export async function submitProduct(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  const parsed = parseProduct(form); if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields." };
  let productId: number;
  try { productId = await saveProduct(prisma, parsed.value, id ?? undefined); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Product could not be saved. Check that the SKU is unique.") }; }
  revalidatePath("/products"); redirect(`/products/${productId}/edit`);
}
export async function changeProductState(id: number, state: "active" | "inactive" | "archived", _old: FormState): Promise<FormState> {
  void _old;
  try { await setProductState(prisma, id, state); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Product status could not be changed.") }; }
  revalidatePath("/products"); revalidatePath(`/products/${id}/edit`);
  return { errors: {}, message: `Product ${state === "active" ? "activated" : state === "inactive" ? "deactivated" : "archived"}.` };
}
