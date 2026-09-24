"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseProduct, saveProduct, setProductState } from "@/lib/products";
import { friendlyError } from "@/lib/crm-validation";
import { requireMutation } from '@/lib/current-user';
import { DuplicateSkuError, parseSkuMetadataForm, saveSkuMetadata } from '@/lib/odm-skus';
import { saveFeedbackPath } from '../../lib/save-feedback';
export type ProductSubmittedValues = {
  name: string; categoryId: string; sku: string; description: string; catalogSource: string; active: string;
  odmSubtype: string; baseSkuId: string; baseSkuLabel: string;
  odmCustomerAccountIds: string[]; odmCustomerNames: string[]; odmDescription: string;
  odmPriceRows: Record<string, string[]>;
};
export type FormState = { errors: Record<string, string>; message?: string; existingSku?: { href: string; label: string }; values?: ProductSubmittedValues };
function submittedProductValues(form: FormData): ProductSubmittedValues {
  const value = (key: string) => String(form.get(key) ?? '');
  return {
    name: value('name'), categoryId: value('categoryId'), sku: value('sku') || value('partNumber'), description: value('description'),
    catalogSource: value('catalogSource'), active: value('active'),
    odmSubtype: value('odmSubtype'), baseSkuId: value('baseSkuId'), baseSkuLabel: value('baseSkuLabel'),
    odmCustomerAccountIds: form.getAll('odmCustomerAccountIds').map(String),
    odmCustomerNames: form.getAll('odmCustomerNames').map(String),
    odmDescription: value('odmDescription'),
    odmPriceRows: Object.fromEntries(['odmPriceAccountId','odmCustomerPrice','odmPreviousPrice','odmCurrencyCode','odmTariffPercent','odmTariffAmount','odmEffectiveDate','odmPricingNotes'].map(key => [key, form.getAll(key).map(String)])),
  };
}
export async function submitProduct(id: number | null, _state: FormState, form: FormData): Promise<FormState> {
  await requireMutation('products.write');
  const values = submittedProductValues(form);
  const parsed = parseProduct(form); if (!parsed.value) return { errors: parsed.errors, message: "Please correct the highlighted fields.", values };
  let productId: number;
  try { productId = await saveProduct(prisma, parsed.value, id ?? undefined, id === null ? parseSkuMetadataForm(form, 'sku') : undefined); }
  catch (error) {
    if (error instanceof DuplicateSkuError) return { errors: {}, message: `${error.message}${error.existing.catalogSource === 'ODM' ? ' Edit the existing ODM SKU to add customer associations.' : ''}`, existingSku: { href: `/products/${error.existing.productId}/edit#sku-${error.existing.id}`, label: `${error.existing.productName} / ${error.existing.partNumber}` }, values };
    return { errors: {}, message: friendlyError(error, "Product could not be saved. Check that the SKU is unique."), values };
  }
  revalidatePath("/products"); redirect(saveFeedbackPath(`/products/${productId}/edit`, id ? "updated" : "created"));
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
  const values = submittedProductValues(form);
  let savedId: number;
  try {
    const saved = await saveSkuMetadata(prisma, { productId, skuId: skuId ?? undefined, ...parseSkuMetadataForm(form) });
    savedId = saved.id;
  } catch (error) {
    if (error instanceof DuplicateSkuError) return { errors: {}, message: `${error.message}${error.existing.catalogSource === 'ODM' ? ' Edit the existing ODM SKU to add customer associations.' : ''}`, existingSku: { href: `/products/${error.existing.productId}/edit#sku-${error.existing.id}`, label: `${error.existing.productName} / ${error.existing.partNumber}` }, values };
    return { errors: {}, message: friendlyError(error, 'SKU could not be saved.'), values };
  }
  revalidatePath('/products'); revalidatePath(`/products/${productId}/edit`);
  redirect(saveFeedbackPath(`/products/${productId}/edit#sku-${savedId}`, 'updated'));
}
