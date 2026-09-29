import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizeAccountName } from './accounts';
import { reconcileDemoUnits } from './demo-operations';
import type { Actor } from './authorization';

export class ExistingDemoError extends Error {
  constructor(public id: number) { super(`Request ID already exists. Open Demo ${id} to review or reconcile it.`); }
}

const field = (form: FormData, name: string, max = 4000) => {
  const value = String(form.get(name) ?? '').trim();
  if (value.length > max) throw new Error(`${name} is too long.`);
  return value;
};
const optionalDate = (form: FormData, name: string) => {
  const value = field(form, name, 10);
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be a valid date.`);
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${name} must be a valid date.`);
  return date;
};
const split = (value: string) => value.split(/[;\n]+/).map(part => part.trim()).filter(Boolean);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const skuKey = (value: string) => value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');

export async function backfillExistingRosaDemo(db: PrismaClient, actor: Actor, form: FormData) {
  if (actor.role !== 'ADMIN' || !actor.active || actor.archivedAt) throw new Error('Administrator access required.');
  const requestId = field(form, 'requestId', 100).toLowerCase();
  if (!uuid.test(requestId)) throw new Error('A valid Rosa Request ID is required. CRM cannot generate one.');
  const existing = await db.demoRequest.findUnique({ where: { sourceRequestId: requestId }, select: { id: true } });
  if (existing) throw new ExistingDemoError(existing.id);
  const demoNumber = field(form, 'demoNumber', 100);
  if (demoNumber) {
    const duplicate = await db.demoRequest.findFirst({ where: { demoNumber: { equals: demoNumber, mode: 'insensitive' } }, select: { id: true } });
    if (duplicate) throw new Error(`Demo Number is already used by Demo ${duplicate.id}. Review that record before backfilling.`);
  }
  const status = field(form, 'status', 20);
  if (status !== 'PENDING' && status !== 'APPROVED' && status !== 'SHIPPED') throw new Error('Choose a valid Rosa status.');
  const requestedAt = optionalDate(form, 'requestedAt');
  const reviewedAt = optionalDate(form, 'reviewedAt');
  const shippedAt = optionalDate(form, 'shippedAt');
  if (!requestedAt) throw new Error('Rosa requested date is required.');
  if (status !== 'PENDING' && !reviewedAt) throw new Error('Approved and shipped Demos require a reviewed date.');
  if (status === 'SHIPPED' && !shippedAt) throw new Error('Shipped Demos require a shipment date.');
  if (status !== 'SHIPPED' && shippedAt) throw new Error('A shipment date requires SHIPPED status.');
  if (reviewedAt && reviewedAt < requestedAt || shippedAt && (shippedAt < (reviewedAt ?? requestedAt))) throw new Error('Lifecycle dates are out of order.');
  const requestedBy = field(form, 'requestedBy', 200);
  const reviewedBy = field(form, 'reviewedBy', 200);
  const shippedBy = field(form, 'shippedBy', 200);
  if (!requestedBy) throw new Error('Rosa requester is required.');
  if (status !== 'PENDING' && !reviewedBy) throw new Error('Reviewed by is required.');
  if (status === 'SHIPPED' && !shippedBy) throw new Error('Shipped by is required.');
  const accountId = Number(field(form, 'accountId', 20));
  const sourceAccount = field(form, 'sourceAccount', 200);
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !sourceAccount) throw new Error('Choose an Account and enter the Rosa VAR name.');
  const accounts = await db.account.findMany({ where: { status: 'ACTIVE', archivedAt: null }, select: { id: true, name: true } });
  const account = accounts.find(item => item.id === accountId);
  if (!account) throw new Error('Choose an active Account.');
  const matches = accounts.filter(item => normalizeAccountName(item.name) === normalizeAccountName(sourceAccount));
  if (matches.some(item => item.id !== accountId)) throw new Error(`Rosa VAR also matches Account ${matches.filter(item => item.id !== accountId).map(item => `${item.name} (#${item.id})`).join(', ')}. Review Account mapping before saving.`);
  const durationRaw = field(form, 'durationValue', 10), durationValue = Number(durationRaw);
  const durationUnit = field(form, 'durationUnit', 10);
  if (!Number.isSafeInteger(durationValue) || durationValue < 1 || !['day','week','month'].includes(durationUnit)) throw new Error('Enter a positive duration and unit.');
  const rawItems = Array.from({ length: 5 }, (_, i) => ({ sku: field(form, `sku${i}`, 200), quantity: field(form, `quantity${i}`, 10), serials: split(field(form, `serials${i}`)), tracking: split(field(form, `tracking${i}`)), locations: split(field(form, `locations${i}`)) })).filter(item => item.sku || item.quantity || item.serials.length || item.tracking.length || item.locations.length);
  if (!rawItems.length) throw new Error('Enter at least one Rosa SKU and quantity.');
  const skus = await db.productSku.findMany({ where: { active: true, product: { active: true, archivedAt: null } }, select: { id: true, partNumber: true } });
  const items = rawItems.map(item => {
    const matches = skus.filter(sku => skuKey(sku.partNumber) === skuKey(item.sku));
    const quantity = Number(item.quantity);
    if (matches.length !== 1) throw new Error(`SKU ${item.sku || '(blank)'} has ${matches.length ? 'multiple' : 'no'} active Product matches. Resolve the SKU first.`);
    if (!/^[1-9]\d*$/.test(item.quantity) || !Number.isSafeInteger(quantity) || quantity > 1000) throw new Error('Each SKU requires a quantity from 1 to 1000.');
    if (item.serials.length > quantity || new Set(item.serials.map(value => value.toUpperCase())).size !== item.serials.length) throw new Error('Serials must be unique and no more than quantity.');
    if (item.locations.length > quantity) throw new Error('Inventory locations cannot exceed quantity.');
    return { ...item, quantity, productSkuId: matches[0].id, sourceSku: item.sku };
  });
  const allSerials = items.flatMap(item => item.serials.map(serial => serial.toUpperCase()));
  if (new Set(allSerials).size !== allSerials.length) throw new Error('A serial number occurs on multiple items.');
  const users = await db.user.findMany({ where: { active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true } });
  const resolveUser = (value: string) => { const matches = users.filter(user => `${user.firstName} ${user.lastName}`.toLowerCase() === value.toLowerCase()); return matches.length === 1 ? matches[0].id : null; };
  const header = { requestId, demoNumber, status, requestedAt: field(form, 'requestedAt'), requestedBy, reviewedAt: field(form, 'reviewedAt'), reviewedBy, sourceAccount, shippedAt: field(form, 'shippedAt'), shippedBy, shippingAddress: field(form, 'shippingAddress'), shippingCarrier: field(form, 'shippingCarrier', 200), carrierAccountNumber: field(form, 'carrierAccountNumber', 200), durationValue: durationRaw, durationUnit, notes: field(form, 'notes', 10000), approvalComments: field(form, 'approvalComments', 10000), reason: field(form, 'reason', 2000) };
  const sourceHeader = { 'Request ID': requestId, 'Demo Number': demoNumber, Status: status, 'Requested At': header.requestedAt, 'Requested By': requestedBy, 'Reviewed At': header.reviewedAt, 'Reviewed By': reviewedBy, VAR: sourceAccount, 'Shipping Address': header.shippingAddress, 'Shipping Carrier': header.shippingCarrier, 'Carrier Account Number': header.carrierAccountNumber, 'Shipped At': header.shippedAt, 'Shipped By': shippedBy, 'Duration Value': durationRaw, 'Duration Unit': durationUnit, Notes: header.notes, 'Approval Comments': header.approvalComments };
  const hash = createHash('sha256').update(JSON.stringify({ header, rawItems })).digest('hex');
  try {
    return await db.$transaction(async tx => {
      const prior = await tx.demoRequest.findUnique({ where: { sourceRequestId: requestId }, select: { id: true } });
      if (prior) throw new ExistingDemoError(prior.id);
      if (demoNumber && await tx.demoRequest.findFirst({ where: { demoNumber: { equals: demoNumber, mode: 'insensitive' } }, select: { id: true } })) throw new Error('Demo Number is already in use. Review the existing Demo.');
      const request = await tx.demoRequest.create({ data: { sourceRequestId: requestId, sourceMethod: 'MANUAL_ROSA_BACKFILL', demoNumber: demoNumber || null, status, requestedAt, requestedById: resolveUser(requestedBy), reviewedAt, reviewedById: resolveUser(reviewedBy), accountId, shippedAt, shippedById: resolveUser(shippedBy), shippingAddress: header.shippingAddress || null, shippingCarrier: header.shippingCarrier || null, carrierAccountNumber: header.carrierAccountNumber || null, durationValue, durationUnit, notes: header.notes || null, approvalComments: header.approvalComments || null, sourceHeader } });
      await tx.demoSourceRevision.create({ data: { demoRequestId: request.id, contentHash: hash, sourceFileName: 'Manual Rosa backfill', sourceRowNumbers: [], sourceRows: { header, items: rawItems }, reviewedMappings: { accountId, skuIds: items.map(item => item.productSkuId), userIds: { requestedById: resolveUser(requestedBy), reviewedById: resolveUser(reviewedBy), shippedById: resolveUser(shippedBy) } }, resolvedHeader: header, resolvedItems: items, sourceTimestamp: new Date(`${header.requestedAt}T00:00:00Z`), recordedById: actor.id } });
      const occurrences = new Map<string, number>();
      for (const [index, item] of items.entries()) {
        const key = skuKey(item.sourceSku);
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        const saved = await tx.demoItem.create({ data: { demoRequestId: request.id, sourceLineKey: `${key}:${occurrence}`, sourceRowNumber: index + 1, sourceSku: item.sourceSku, productSkuId: item.productSkuId, quantity: item.quantity, serialNumbers: item.serials, trackingNumbers: item.tracking, inventoryLocations: item.locations, sourceValues: rawItems[index] } });
        await reconcileDemoUnits(tx, saved.id, item.quantity, item.serials, item.locations, status, shippedAt);
      }
      return request;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await db.demoRequest.findUnique({ where: { sourceRequestId: requestId }, select: { id: true } });
      if (duplicate) throw new ExistingDemoError(duplicate.id);
      throw new Error('Demo Number or source identity already exists. Review the existing Demo.');
    }
    throw error;
  }
}
