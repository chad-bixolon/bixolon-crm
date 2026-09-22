import { ProductCatalogSource, OdmCustomizationSubtype, type PrismaClient, type Prisma } from '@prisma/client';
import { normalizePartNumber, normalizeAccountName } from './product-import';

type Db = PrismaClient | Prisma.TransactionClient;

export async function resolveOdmAccount(db: Db, name: string) {
  if (!name.trim()) return null;
  const rows = await db.account.findMany({ where: { name: { equals: name.trim(), mode: 'insensitive' } }, select: { id: true, name: true } });
  const matches = rows.filter(row => normalizeAccountName(row.name) === normalizeAccountName(name));
  return matches.length === 1 ? matches[0] : null;
}

export async function saveSkuMetadata(db: PrismaClient, input: {
  productId: number; skuId?: number; partNumber: string; description: string | null;
  catalogSource: ProductCatalogSource | null; odmCustomerAccountIds: number[];
  odmSubtype: OdmCustomizationSubtype | null; baseSkuId: number | null; odmDescription: string | null;
}) {
  return db.$transaction(async tx => {
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
    if (input.catalogSource === 'ODM' && !input.odmSubtype && !current) throw new Error('ODM subtype is required for new SKUs.');
    const key = normalizePartNumber(input.partNumber);
    const duplicate = await tx.productSku.findUnique({ where: { normalizedPartNumber: key } });
    if (duplicate && duplicate.id !== input.skuId) throw new Error('Part number already exists.');
    const accountIds = [...new Set(input.odmCustomerAccountIds)];
    if (current?.odmCustomers.length && input.catalogSource !== 'ODM') throw new Error('Remove ODM customer associations explicitly before changing Catalog Source.');
    if (input.odmSubtype === 'CUSTOMER_SPECIFIC' && !accountIds.length && !(current?.odmSubtype === 'CUSTOMER_SPECIFIC' && current.odmCustomers.length === 0)) throw new Error('Customer-specific ODM requires an associated Account.');
    if (input.catalogSource !== 'ODM' && accountIds.length) throw new Error('ODM Customer fields require Catalog Source ODM.');
    if (input.catalogSource !== 'ODM' && (input.baseSkuId || input.odmDescription)) throw new Error('Base SKU and description require Catalog Source ODM.');
    if (accountIds.some(id => !Number.isSafeInteger(id) || id <= 0) || await tx.account.count({ where: { id: { in: accountIds }, archivedAt: null } }) !== accountIds.length) throw new Error('ODM Customer must be an existing Account.');
    if (input.baseSkuId) {
      if (input.baseSkuId === input.skuId) throw new Error('A SKU cannot be its own Base SKU.');
      const base = await tx.productSku.findUnique({ where: { id: input.baseSkuId }, select: { catalogSource: true } });
      if (!base || base.catalogSource === 'ODM') throw new Error('Base SKU must be an existing non-ODM SKU.');
    }
    if (input.catalogSource === 'ODM' && input.skuId && await tx.productSku.count({ where: { baseSkuId: input.skuId } })) throw new Error('An ODM SKU cannot be used as a Base SKU.');
    const data = { partNumber: input.partNumber.trim(), normalizedPartNumber: key, description: input.description,
      catalogSource: input.catalogSource,
      odmSubtype: input.catalogSource === 'ODM' ? input.odmSubtype : null,
      baseSkuId: input.catalogSource === 'ODM' ? input.baseSkuId : null,
      odmDescription: input.catalogSource === 'ODM' ? input.odmDescription : null,
      odmCustomerSourceName: input.catalogSource === 'ODM' ? current?.odmCustomerSourceName ?? null : null };
    if (current) {
      await tx.productSkuOdmCustomer.deleteMany({ where: { skuId: current.id, accountId: { notIn: accountIds } } });
      await tx.productSku.update({ where: { id: current.id }, data });
    }
    const sku = current ?? await tx.productSku.create({ data: { ...data, productId: input.productId } });
    for (const accountId of accountIds) await tx.productSkuOdmCustomer.upsert({ where: { skuId_accountId: { skuId: sku.id, accountId } }, create: { skuId: sku.id, accountId }, update: {} });
    return sku;
  });
}
