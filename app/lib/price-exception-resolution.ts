import type { Prisma, PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import { positiveId } from './crm-validation';

export const priceExceptionAccountFields = ['distributorAccountId', 'varAccountId', 'endUserAccountId'] as const;
export type PriceExceptionAccountField = typeof priceExceptionAccountFields[number];
export type PriceExceptionAccountPatch = Partial<Record<PriceExceptionAccountField, number | null>>;
export type PriceExceptionAccountValues = Partial<Record<PriceExceptionAccountField, string>>;

export function parsePriceExceptionAccountPatch(form: FormData) {
  const errors: Record<string, string> = {};
  const values: PriceExceptionAccountValues = {};
  const patch: PriceExceptionAccountPatch = {};
  for (const field of priceExceptionAccountFields) {
    if (!form.has(field)) continue;
    const raw = String(form.get(field) ?? '').trim();
    values[field] = raw;
    if (!raw) patch[field] = null;
    else {
      const id = positiveId(raw);
      if (!id) errors[field] = 'Choose a valid existing Account.';
      else patch[field] = id;
    }
  }
  if (!Object.keys(patch).length && !Object.keys(errors).length) errors.form = 'No Account links were submitted.';
  return { patch, values, errors };
}

export class PriceExceptionAccountValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) { super('Invalid Price Exception Account links.'); }
}

type Db = PrismaClient | Prisma.TransactionClient;
export async function updatePriceExceptionAccountLinks(db: Db, priceExceptionId: number, actor: Actor, patch: PriceExceptionAccountPatch) {
  assertPermission(actor, 'users.manage');
  if (!Number.isSafeInteger(priceExceptionId) || priceExceptionId <= 0) throw new PriceExceptionAccountValidationError({ form: 'Invalid Price Exception.' });
  const entries = Object.entries(patch) as [PriceExceptionAccountField, number | null][];
  if (!entries.length || entries.some(([field]) => !priceExceptionAccountFields.includes(field))) throw new PriceExceptionAccountValidationError({ form: 'No valid Account links were submitted.' });
  const requestedIds = [...new Set(entries.map(([, id]) => id).filter((id): id is number => id !== null))];
  const [existingPriceException, accounts] = await Promise.all([
    db.priceException.findUnique({ where: { id: priceExceptionId }, select: { distributorAccountId: true, varAccountId: true, endUserAccountId: true } }),
    requestedIds.length ? db.account.findMany({ where: { id: { in: requestedIds } }, select: { id: true } }) : Promise.resolve([]),
  ]);
  if (!existingPriceException) throw new PriceExceptionAccountValidationError({ form: 'Price Exception not found.' });
  const found = new Set(accounts.map(account => account.id));
  const errors: Record<string, string> = {};
  for (const [field, id] of entries) if (id !== null && !found.has(id)) errors[field] = 'The selected Account no longer exists.';
  if (Object.keys(errors).length) throw new PriceExceptionAccountValidationError(errors);
  await db.priceException.update({ where: { id: priceExceptionId }, data: { ...patch, updatedById: actor.id } });
  const current = { ...existingPriceException, ...patch };
  return {
    previousAccountIds: priceExceptionAccountFields.map(field => existingPriceException[field]).filter((id): id is number => id !== null),
    currentAccountIds: priceExceptionAccountFields.map(field => current[field]).filter((id): id is number => id !== null),
  };
}
