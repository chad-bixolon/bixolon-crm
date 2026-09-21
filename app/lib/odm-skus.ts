import { ProductCatalogSource, type PrismaClient, type Prisma } from '@prisma/client';
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
  catalogSource: ProductCatalogSource | null; odmCustomerAccountId: number | null;
  baseSkuId: number | null; odmDescription: string | null;
}) {
  return db.$transaction(async tx => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product || product.archivedAt) throw new Error('Product is unavailable.');
    const current = input.skuId ? await tx.productSku.findUnique({ where: { id: input.skuId } }) : null;
    if (input.skuId && (!current || current.productId !== input.productId)) throw new Error('SKU is unavailable.');
    if (!input.partNumber.trim() || input.partNumber.length > 100) throw new Error('Part number is required and must be at most 100 characters.');
    if (input.description && input.description.length > 2000) throw new Error('Description exceeds 2000 characters.');
    if (input.odmDescription && input.odmDescription.length > 2000) throw new Error('ODM Description exceeds 2000 characters.');
    const key = normalizePartNumber(input.partNumber);
    const duplicate = await tx.productSku.findUnique({ where: { normalizedPartNumber: key } });
    if (duplicate && duplicate.id !== input.skuId) throw new Error('Part number already exists.');
    if (input.catalogSource !== 'ODM' && (input.odmCustomerAccountId || input.baseSkuId || input.odmDescription)) throw new Error('ODM fields require Catalog Source ODM.');
    if (input.odmCustomerAccountId && !await tx.account.findUnique({ where: { id: input.odmCustomerAccountId }, select: { id: true } })) throw new Error('ODM Customer must be an existing Account.');
    if (input.baseSkuId) {
      if (input.baseSkuId === input.skuId) throw new Error('A SKU cannot be its own Base SKU.');
      const base = await tx.productSku.findUnique({ where: { id: input.baseSkuId }, select: { catalogSource: true } });
      if (!base || base.catalogSource === 'ODM') throw new Error('Base SKU must be an existing non-ODM SKU.');
    }
    if (input.catalogSource === 'ODM' && input.skuId && await tx.productSku.count({ where: { baseSkuId: input.skuId } })) throw new Error('An ODM SKU cannot be used as a Base SKU.');
    const data = { partNumber: input.partNumber.trim(), normalizedPartNumber: key, description: input.description,
      catalogSource: input.catalogSource, odmCustomerAccountId: input.catalogSource === 'ODM' ? input.odmCustomerAccountId : null,
      baseSkuId: input.catalogSource === 'ODM' ? input.baseSkuId : null,
      odmDescription: input.catalogSource === 'ODM' ? input.odmDescription : null,
      odmCustomerSourceName: input.catalogSource === 'ODM' && !input.odmCustomerAccountId ? current?.odmCustomerSourceName ?? null : null };
    return current ? tx.productSku.update({ where: { id: current.id }, data }) : tx.productSku.create({ data: { ...data, productId: input.productId } });
  });
}
