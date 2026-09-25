import { ProductCatalogSource, OdmCustomizationSubtype, type PrismaClient, type Prisma } from '@prisma/client';
import { normalizePartNumber, normalizeAccountName } from './product-import';
import { calculateOdmCustomerPrice, parseOdmPriceForm, type SubmittedOdmPrice } from './odm-customer-pricing';

type Db = PrismaClient | Prisma.TransactionClient;
export type SkuMetadataInput = {
  productId: number; skuId?: number; partNumber: string; description: string | null; active: boolean;
  catalogSource: ProductCatalogSource | null; odmCustomerAccountIds: number[];
  odmSubtype: OdmCustomizationSubtype | null; baseSkuId: number | null; odmDescription: string | null;
  odmPrices?: SubmittedOdmPrice[];
};

export function parseSkuMetadataForm(form: FormData, partNumberField = 'partNumber'): Omit<SkuMetadataInput, 'productId' | 'skuId'> {
  const sourceText = String(form.get('catalogSource') ?? '');
  if (sourceText && (!Object.values(ProductCatalogSource).includes(sourceText as ProductCatalogSource) || sourceText === 'SPECIAL_SKU_LIST')) throw new Error('Choose a valid Catalog Source.');
  const catalogSource = sourceText ? sourceText as ProductCatalogSource : null;
  const subtypeText = String(form.get('odmSubtype') ?? '');
  if (subtypeText && !Object.values(OdmCustomizationSubtype).includes(subtypeText as OdmCustomizationSubtype)) throw new Error('Choose a valid ODM subtype.');
  const baseText = String(form.get('baseSkuId') ?? '');
  const baseSkuId = baseText ? Number(baseText) : null;
  if (baseText && (!Number.isSafeInteger(baseSkuId) || Number(baseSkuId) <= 0)) throw new Error('Base SKU is invalid.');
  return {
    partNumber: String(form.get(partNumberField) ?? ''), description: String(form.get('description') ?? '').trim() || null,
    active: String(form.get('active') ?? 'true') !== 'false', catalogSource,
    odmSubtype: catalogSource === 'ODM' ? subtypeText as OdmCustomizationSubtype || null : null,
    odmCustomerAccountIds: catalogSource === 'ODM' ? form.getAll('odmCustomerAccountIds').map(value => Number(value)) : [],
    baseSkuId: catalogSource === 'ODM' ? baseSkuId : null,
    odmDescription: catalogSource === 'ODM' ? String(form.get('odmDescription') ?? '').trim() || null : null,
    odmPrices: catalogSource === 'ODM' ? parseOdmPriceForm(form) : [],
  };
}

export class DuplicateSkuError extends Error {
  constructor(public readonly existing: { id: number; partNumber: string; productId: number; productName: string; catalogSource: ProductCatalogSource | null }) {
    super(`Part number already exists as ${existing.partNumber} on Product ${existing.productName}.`);
  }
}

export async function resolveOdmAccount(db: Db, name: string) {
  if (!name.trim()) return null;
  const rows = await db.account.findMany({ where: { name: { equals: name.trim(), mode: 'insensitive' } }, select: { id: true, name: true } });
  const matches = rows.filter(row => normalizeAccountName(row.name) === normalizeAccountName(name));
  return matches.length === 1 ? matches[0] : null;
}

export async function saveSkuMetadata(db: PrismaClient, input: SkuMetadataInput) {
  return db.$transaction(tx => saveSkuMetadataInTransaction(tx, input));
}

export async function saveSkuMetadataInTransaction(tx: Prisma.TransactionClient, input: SkuMetadataInput) {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product || product.archivedAt) throw new Error('Product is unavailable.');
    const current = input.skuId ? await tx.productSku.findUnique({ where: { id: input.skuId }, include: { odmCustomers: true } }) : null;
    if (input.skuId && (!current || current.productId !== input.productId)) throw new Error('SKU is unavailable.');
    if (!input.partNumber.trim() || input.partNumber.length > 100) throw new Error('Part number is required and must be at most 100 characters.');
    if (input.description && input.description.length > 2000) throw new Error('Description exceeds 2000 characters.');
    if (input.odmDescription && input.odmDescription.length > 2000) throw new Error('ODM Description exceeds 2000 characters.');
    if (input.catalogSource === 'SPECIAL_SKU_LIST') throw new Error('Use ODM with a customization subtype.');
    if (input.odmSubtype && input.catalogSource !== 'ODM') throw new Error('ODM subtype requires Catalog Source ODM.');
    if (input.odmSubtype === 'LEGACY_SPECIAL_SKU' && current?.odmSubtype !== 'LEGACY_SPECIAL_SKU') throw new Error('Legacy Special SKU is reserved for migrated records.');
    if (input.catalogSource === 'ODM' && !input.odmSubtype && (!current || current.catalogSource !== 'ODM' || current.odmSubtype)) throw new Error('ODM subtype is required.');
    const key = normalizePartNumber(input.partNumber);
    const duplicate = await tx.productSku.findUnique({ where: { normalizedPartNumber: key }, include: { product: { select: { name: true } } } });
    if (duplicate && duplicate.id !== input.skuId) throw new DuplicateSkuError({ id: duplicate.id, partNumber: duplicate.partNumber, productId: duplicate.productId, productName: duplicate.product.name, catalogSource: duplicate.catalogSource });
    const accountIds = [...new Set(input.odmCustomerAccountIds)];
    if (current?.catalogSource === 'ODM' && input.catalogSource !== 'ODM') throw new Error('Existing ODM SKUs cannot change Catalog Source because their classification and customer history must be preserved.');
    if (input.catalogSource !== 'ODM' && accountIds.length) throw new Error('ODM Customer fields require Catalog Source ODM.');
    if (input.catalogSource !== 'ODM' && (input.baseSkuId || input.odmDescription)) throw new Error('Base SKU and description require Catalog Source ODM.');
    const retainedIds = new Set(current?.odmCustomers.filter(link => !link.archivedAt).map(link => link.accountId) ?? []);
    const newIds = accountIds.filter(id => !retainedIds.has(id));
    if (accountIds.some(id => !Number.isSafeInteger(id) || id <= 0) || await tx.account.count({ where: { id: { in: newIds }, status: 'ACTIVE', archivedAt: null } }) !== newIds.length) throw new Error('ODM Customer must be an existing active Account.');
    const relevantChange = !current || current.catalogSource !== 'ODM' || current.odmSubtype !== input.odmSubtype || current.baseSkuId !== input.baseSkuId || current.odmDescription !== input.odmDescription || accountIds.length !== retainedIds.size || accountIds.some(id => !retainedIds.has(id));
    if (input.odmSubtype === 'CUSTOMER_SPECIFIC' && !accountIds.length && relevantChange) throw new Error('Customer-specific ODM requires at least one active Account.');
    if (input.odmSubtype === 'CUSTOMER_SPECIFIC' && accountIds.length && relevantChange && await tx.account.count({ where: { id: { in: accountIds }, status: 'ACTIVE', archivedAt: null } }) === 0) throw new Error('Customer-specific ODM requires at least one active Account.');
    if (input.odmPrices?.length && (input.catalogSource !== 'ODM' || input.odmSubtype !== 'CUSTOMER_SPECIFIC')) throw new Error('Customer pricing requires a Customer-Specific ODM SKU.');
    if (input.odmPrices?.some(price => !accountIds.includes(price.accountId))) throw new Error('ODM pricing Account must be associated with this SKU.');
    const calculatedPrices = input.odmPrices?.map(price => ({ accountId: price.accountId, ...calculateOdmCustomerPrice(price) })) ?? [];
    if (input.baseSkuId) {
      if (input.baseSkuId === input.skuId) throw new Error('A SKU cannot be its own Base SKU.');
      const base = await tx.productSku.findUnique({ where: { id: input.baseSkuId }, select: { catalogSource: true, active: true, product: { select: { active: true, archivedAt: true } } } });
      if (!base || !base.active || !base.product.active || base.product.archivedAt || base.catalogSource === 'ODM') throw new Error('Base SKU must be an existing non-ODM SKU.');
    }
    if (input.catalogSource === 'ODM' && input.skuId && await tx.productSku.count({ where: { baseSkuId: input.skuId } })) throw new Error('An ODM SKU cannot be used as a Base SKU.');
    const data = { partNumber: input.partNumber.trim(), normalizedPartNumber: key, description: input.description, active: input.active,
      catalogSource: input.catalogSource,
      odmSubtype: input.catalogSource === 'ODM' ? input.odmSubtype : null,
      baseSkuId: input.catalogSource === 'ODM' ? input.baseSkuId : null,
      odmDescription: input.catalogSource === 'ODM' ? input.odmDescription : null,
      odmCustomerSourceName: input.catalogSource === 'ODM' ? current?.odmCustomerSourceName ?? null : null };
    if (current) {
      await tx.productSkuOdmCustomer.updateMany({ where: { skuId: current.id, accountId: { notIn: accountIds }, archivedAt: null }, data: { archivedAt: new Date() } });
      await tx.productSkuOdmCustomerPrice.updateMany({ where: { skuId: current.id, accountId: { notIn: accountIds }, archivedAt: null }, data: { archivedAt: new Date() } });
      if (input.odmSubtype !== 'CUSTOMER_SPECIFIC') await tx.productSkuOdmCustomerPrice.updateMany({ where: { skuId: current.id, archivedAt: null }, data: { archivedAt: new Date() } });
      await tx.productSku.update({ where: { id: current.id }, data });
    }
    const sku = current ?? await tx.productSku.create({ data: { ...data, productId: input.productId } });
    for (const accountId of accountIds) await tx.productSkuOdmCustomer.upsert({ where: { skuId_accountId: { skuId: sku.id, accountId } }, create: { skuId: sku.id, accountId }, update: { archivedAt: null } });
    for (const price of calculatedPrices) {
      const active = await tx.productSkuOdmCustomerPrice.findFirst({ where: { skuId: sku.id, accountId: price.accountId, archivedAt: null } });
      const { accountId, ...terms } = price;
      if (active && active.currencyCode === terms.currencyCode && active.customerPrice.equals(terms.customerPrice) && (active.previousPrice?.toFixed(2) ?? null) === terms.previousPrice && active.tariffPercent.equals(terms.tariffPercent) && active.tariffAmount.equals(terms.tariffAmount) && active.finalUnitPrice.equals(terms.finalUnitPrice) && (active.effectiveDate?.toISOString().slice(0,10) ?? null) === (terms.effectiveDate?.toISOString().slice(0,10) ?? null) && active.notes === terms.notes) continue;
      if (active) await tx.productSkuOdmCustomerPrice.update({ where: { id: active.id }, data: { archivedAt: new Date() } });
      await tx.productSkuOdmCustomerPrice.create({ data: { skuId: sku.id, accountId, ...terms, sourceType: 'MANUAL' } });
    }
    return sku;
}
