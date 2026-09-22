"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseProduct, saveProduct, setProductState } from "@/lib/products";
import { friendlyError } from "@/lib/crm-validation";
import { ProductCatalogSource, OdmCustomizationSubtype } from '@prisma/client';
import { requireMutation } from '@/lib/current-user';
import { saveSkuMetadata } from '@/lib/odm-skus';
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
export async function submitProductSku(productId: number, skuId: number | null, _state: FormState, form: FormData): Promise<FormState> {
  await requireMutation('products.write');
  const sourceText = String(form.get('catalogSource') ?? '');
  if (sourceText && (!Object.values(ProductCatalogSource).includes(sourceText as ProductCatalogSource) || sourceText === 'SPECIAL_SKU_LIST')) return { errors: {}, message: 'Choose a valid Catalog Source.' };
  const source = sourceText ? sourceText as ProductCatalogSource : null;
  const subtypeText = String(form.get('odmSubtype') ?? '');
  if (subtypeText && !Object.values(OdmCustomizationSubtype).includes(subtypeText as OdmCustomizationSubtype)) return { errors: {}, message: 'Choose a valid ODM subtype.' };
  const parseId = (name: string) => {
    const value = String(form.get(name) ?? '');
    if (!value) return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${name === 'baseSkuId' ? 'Base SKU' : 'ODM Customer'} is invalid.`);
    return id;
  };
  let savedId: number;
  try {
    const saved = await saveSkuMetadata(prisma, { productId, skuId: skuId ?? undefined,
      partNumber: String(form.get('partNumber') ?? ''), description: String(form.get('description') ?? '').trim() || null,
      catalogSource: source, odmCustomerAccountIds: source === 'ODM' ? form.getAll('odmCustomerAccountIds').map(value => Number(value)) : [],
      odmSubtype: source === 'ODM' ? (subtypeText as OdmCustomizationSubtype || null) : null,
      baseSkuId: source === 'ODM' ? parseId('baseSkuId') : null,
      odmDescription: source === 'ODM' ? String(form.get('odmDescription') ?? '').trim() || null : null });
    savedId = saved.id;
  } catch (error) { return { errors: {}, message: friendlyError(error, 'SKU could not be saved.') }; }
  revalidatePath('/products'); revalidatePath(`/products/${productId}/edit`);
  redirect(`/products/${productId}/edit#sku-${savedId}`);
}
