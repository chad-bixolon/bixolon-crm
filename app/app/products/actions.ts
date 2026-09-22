"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseProduct, saveProduct, setProductState } from "@/lib/products";
import { friendlyError } from "@/lib/crm-validation";
import { requireMutation } from '@/lib/current-user';
import { DuplicateSkuError, parseSkuMetadataForm, saveSkuMetadata } from '@/lib/odm-skus';
export type FormState = { errors: Record<string, string>; message?: string; existingSku?: { href: string; label: string } };
export async function submitProduct(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  await requireMutation('products.write');
  const parsed = parseProduct(form); if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields." };
  let productId: number;
  try { productId = await saveProduct(prisma, parsed.value, id ?? undefined, id === null ? parseSkuMetadataForm(form, 'sku') : undefined); }
  catch (error) {
    if (error instanceof DuplicateSkuError) return { errors: {}, message: `${error.message}${error.existing.catalogSource === 'ODM' ? ' Edit the existing ODM SKU to add customer associations.' : ''}`, existingSku: { href: `/products/${error.existing.productId}/edit#sku-${error.existing.id}`, label: `${error.existing.productName} / ${error.existing.partNumber}` } };
    return { errors: {}, message: friendlyError(error, "Product could not be saved. Check that the SKU is unique.") };
  }
  revalidatePath("/products"); redirect(`/products/${productId}/edit`);
}
export async function changeProductState(id: number, state: "active" | "inactive" | "archived", _old: FormState): Promise<FormState> {
  void _old;
  await requireMutation('products.write');
  try { await setProductState(prisma, id, state); }
  catch (error) { return { errors: {}, message: friendlyError(error, "Product status could not be changed.") }; }
  revalidatePath("/products"); revalidatePath(`/products/${id}/edit`);
  return { errors: {}, message: `Product ${state === "active" ? "activated" : state === "inactive" ? "deactivated" : "archived"}.` };
}
export async function submitProductSku(productId: number, skuId: number | null, _state: FormState, form: FormData): Promise<FormState> {
  await requireMutation('products.write');
  let savedId: number;
  try {
    const saved = await saveSkuMetadata(prisma, { productId, skuId: skuId ?? undefined, ...parseSkuMetadataForm(form) });
    savedId = saved.id;
  } catch (error) {
    if (error instanceof DuplicateSkuError) return { errors: {}, message: `${error.message}${error.existing.catalogSource === 'ODM' ? ' Edit the existing ODM SKU to add customer associations.' : ''}`, existingSku: { href: `/products/${error.existing.productId}/edit#sku-${error.existing.id}`, label: `${error.existing.productName} / ${error.existing.partNumber}` } };
    return { errors: {}, message: friendlyError(error, 'SKU could not be saved.') };
  }
  revalidatePath('/products'); revalidatePath(`/products/${productId}/edit`);
  redirect(`/products/${productId}/edit#sku-${savedId}`);
}
