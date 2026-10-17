import type { PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import { parseCompetitor } from './competitors';

export function parseOutcomeReason(form: FormData) {
  const value = parseCompetitor(form);
  const status = String(form.get('status') ?? '');
  if (!['won', 'lost'].includes(status)) throw new Error('Choose Closed Won or Closed Lost.');
  return { ...value, isWon: status === 'won' };
}
export async function saveOutcomeReason(client: PrismaClient, actor: Actor, input: ReturnType<typeof parseOutcomeReason>, id?: number) {
  assertPermission(actor, 'users.manage');
  return client.$transaction(async tx => {
    const existing = id ? await tx.outcomeReason.findUnique({ where: { id } }) : null;
    if (id && !existing) throw new Error('Outcome Reason not found.');
    // Never reinterpret prior Won/Lost references. Add a new value instead.
    if (existing && existing.isWon !== input.isWon) throw new Error('The close state cannot be changed. Add a new Outcome Reason instead.');
    const duplicate = await tx.outcomeReason.findFirst({ where: { isWon: input.isWon, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
    if (duplicate) throw new Error('An Outcome Reason with this name already exists for this close state.');
    return id ? tx.outcomeReason.update({ where: { id }, data: input }) : tx.outcomeReason.create({ data: input });
  });
}
