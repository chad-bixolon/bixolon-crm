import type { PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';

function validate(name: string, sortOrder: number) {
  if (!name.trim() || name.trim().length > 120) throw new Error('Category name must be 1–120 characters.');
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) throw new Error('Sort order must be a nonnegative whole number.');
}
export function listSupportCaseCategories(db: PrismaClient, actor: Actor, activeOnly = true) {
  assertPermission(actor, 'support-cases.read');
  return db.supportCaseCategory.findMany({ where: activeOnly ? { active: true } : {}, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
}
export async function saveSupportCaseCategory(db: PrismaClient, actor: Actor, data: { name: string; sortOrder: number; active: boolean }, id?: number) {
  assertPermission(actor, 'support-categories.manage');
  validate(data.name, data.sortOrder);
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid category.');
  const clean = { ...data, name: data.name.trim() };
  return id === undefined ? db.supportCaseCategory.create({ data: clean }) : db.supportCaseCategory.update({ where: { id }, data: clean });
}
