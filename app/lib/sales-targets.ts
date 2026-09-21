import { Prisma, SalesQuarter, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';

export function parseSalesTarget(form: FormData) {
  const userId = Number(form.get('userId'));
  const year = Number(form.get('year'));
  const quarter = String(form.get('quarter')) as SalesQuarter;
  const currencyCode = String(form.get('currencyCode') ?? '');
  const amount = String(form.get('targetAmount') ?? '').trim();
  const notes = String(form.get('notes') ?? '').trim();
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isInteger(year) || year < 2000 || year > 2100 || !Object.values(SalesQuarter).includes(quarter) || !/^[A-Z]{3}$/.test(currencyCode) || !/^\d{1,16}(\.\d{1,2})?$/.test(amount) || notes.length > 2000) throw new Error('Choose a valid sales rep, period, currency, amount, and notes.');
  return { userId, year, quarter, currencyCode, targetAmount: new Prisma.Decimal(amount), notes: notes || null };
}

export async function saveSalesTarget(client: PrismaClient, actor: Actor, form: FormData, id?: number) {
  if (!can(actor, 'users.manage') || actor.role !== 'ADMIN') throw new Error('Access denied');
  const data = parseSalesTarget(form);
  const [user, currency, old] = await Promise.all([
    client.user.findUnique({ where: { id: data.userId } }),
    client.currency.findUnique({ where: { code: data.currencyCode } }),
    id ? client.salesTarget.findUnique({ where: { id } }) : null,
  ]);
  if (!user?.active || user.archivedAt || !['SALES', 'SALES_MANAGER'].includes(user.role)) throw new Error('Choose an active sales rep.');
  if (!currency?.active) throw new Error('Choose an active currency.');
  if (id && (!old || old.archivedAt)) throw new Error('Active target not found.');
  return id ? client.salesTarget.update({ where: { id }, data: { ...data, updatedById: actor.id } }) : client.salesTarget.create({ data: { ...data, createdById: actor.id } });
}

export async function archiveSalesTarget(client: PrismaClient, actor: Actor, id: number) {
  if (!can(actor, 'users.manage') || actor.role !== 'ADMIN') throw new Error('Access denied');
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid target.');
  return client.salesTarget.update({ where: { id, archivedAt: null }, data: { archivedAt: new Date(), updatedById: actor.id } });
}
