import type { DemoUnitStatus, Prisma } from '@prisma/client';

export type UnitState = { id: number; ordinal: number; serialNumber: string | null; status: DemoUnitStatus; deployedAt: Date | null; returnedAt: Date | null; inventoryLocation: string | null };
export type DemoState = { shippedAt: Date | null; durationValue: number | null; durationUnit: string | null; expectedReturnOverrideAt: Date | null; opportunity?: { stage: { isClosed: boolean; isWon: boolean } } | null; project?: { status: string; archivedAt?: Date | null } | null; items: { quantity: number; retiredAt?: Date | null; units: UnitState[] }[] };
const day = 86_400_000;
export const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
export function addDemoDuration(shippedAt: Date | null, value: number | null, unit: string | null): Date | null {
  if (!shippedAt || !value || !unit) return null;
  const result = new Date(shippedAt);
  if (unit === 'day') result.setUTCDate(result.getUTCDate() + value);
  else if (unit === 'week') result.setUTCDate(result.getUTCDate() + value * 7);
  else if (unit === 'month') {
    const originalDay = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + value);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(originalDay, lastDay));
  } else return null;
  return result;
}
export function demoSummary(request: DemoState, today = new Date()) {
  const units = request.items.filter(item => !item.retiredAt || item.units.some(unit => !!unit.deployedAt)).flatMap(item => item.units);
  const deployed = units.filter(unit => unit.deployedAt !== null);
  const returned = deployed.filter(unit => unit.returnedAt !== null);
  const outstanding = deployed.filter(unit => unit.returnedAt === null);
  const firstDeployment = deployed.map(unit => unit.deployedAt!).sort((a, b) => a.valueOf() - b.valueOf())[0] ?? null;
  const calculated = addDemoDuration(request.shippedAt ?? firstDeployment, request.durationValue, request.durationUnit);
  const expected = request.expectedReturnOverrideAt ?? calculated;
  const overdue = outstanding.length > 0 && !!expected && dateOnly(expected) < dateOnly(today);
  const contextRecovery = !!request.opportunity?.stage.isClosed && !request.opportunity.stage.isWon || ['CANCELLED', 'COMPLETED'].includes(request.project?.status ?? '') || !!request.project?.archivedAt;
  return { total: units.length, deployed: deployed.length, returned: returned.length, outstanding: outstanding.length, open: outstanding.length > 0, calculated, expected, overdue, recoveryAttention: outstanding.length > 0 && (overdue || contextRecovery) };
}
export function opportunityResult(opportunity: DemoState['opportunity']) {
  return !opportunity ? '—' : !opportunity.stage.isClosed ? 'Open' : opportunity.stage.isWon ? 'Won' : 'Lost';
}
export function daysDeployed(unit: Pick<UnitState, 'deployedAt' | 'returnedAt'>, today = new Date()) {
  if (!unit.deployedAt) return null;
  return Math.max(0, Math.floor((Date.parse(dateOnly(unit.returnedAt ?? today)) - Date.parse(dateOnly(unit.deployedAt))) / day));
}

type Db = Prisma.TransactionClient;
/** Assign source serials to existing anonymous slots before creating any new slots. CRM returns win over source shipment state. */
export async function reconcileDemoUnits(tx: Db, itemId: number, quantity: number, serials: string[], locations: string[], status: 'PENDING' | 'APPROVED' | 'SHIPPED', shippedAt: Date | null) {
  if (serials.length > quantity || new Set(serials.map(value => value.toUpperCase())).size !== serials.length) throw new Error('Source serial count must be unique and no greater than quantity.');
  const prior = await tx.demoUnit.findMany({ where: { demoItemId: itemId }, orderBy: { ordinal: 'asc' } });
  if (prior.length > quantity && prior.slice(quantity).some(unit => unit.deployedAt || unit.returnedAt || unit.serialNumber)) throw new Error('Cannot reduce quantity below a tracked Demo unit.');
  for (let ordinal = prior.length + 1; ordinal <= quantity; ordinal++) prior.push(await tx.demoUnit.create({ data: { demoItemId: itemId, ordinal } }));
  const slots = prior.slice(0, quantity);
  const assignments = new Map<number, string>();
  for (const serial of serials) {
    const matched = slots.find(unit => unit.serialNumber?.toUpperCase() === serial.toUpperCase());
    if (matched) assignments.set(matched.id, serial);
    else {
      const blank = slots.find(unit => !unit.serialNumber && !assignments.has(unit.id));
      if (!blank) throw new Error('Source serial conflicts with existing physical Demo units.');
      assignments.set(blank.id, serial);
    }
  }
  for (const unit of slots) {
    const sourceStatus = status === 'SHIPPED' ? 'DEPLOYED' : status === 'APPROVED' ? 'APPROVED' : 'REQUESTED';
    await tx.demoUnit.update({ where: { id: unit.id }, data: {
      serialNumber: assignments.get(unit.id) ?? unit.serialNumber,
      inventoryLocation: (locations.length === 1 ? locations[0] : locations[unit.ordinal - 1]) ?? unit.inventoryLocation,
      status: unit.returnedAt ? 'RETURNED' : unit.deployedAt ? 'DEPLOYED' : sourceStatus,
      deployedAt: unit.deployedAt ?? (status === 'SHIPPED' ? shippedAt : null),
    } });
  }
  if (prior.length > quantity) await tx.demoUnit.deleteMany({ where: { id: { in: prior.slice(quantity).map(unit => unit.id) } } });
}

export type DemoReportFilters = { state?: string; overdue?: string; recovery?: string; accountId?: string; ownerId?: string; productId?: string; skuId?: string; projectId?: string; opportunityId?: string; opportunityResult?: string; projectStatus?: string; deployedFrom?: string; deployedTo?: string; expectedFrom?: string; expectedTo?: string; demoStatus?: string };
const matchesId = (filter: string | undefined, actual: number | null) => !filter || Number(filter) === actual;
const matchesDateRange = (value: Date | null, from?: string, to?: string) => (!from || !!value && dateOnly(value) >= from) && (!to || !!value && dateOnly(value) <= to);
export function matchesDemoReportRequest(request: DemoState & { accountId: number; requestedById: number | null; projectId: number | null; opportunityId: number | null; status: string }, summary: ReturnType<typeof demoSummary>, filters: DemoReportFilters) {
  return matchesId(filters.accountId, request.accountId) && matchesId(filters.ownerId, request.requestedById) && matchesId(filters.projectId, request.projectId) && matchesId(filters.opportunityId, request.opportunityId) &&
    (!filters.demoStatus || request.status === filters.demoStatus) && (!filters.overdue || filters.overdue !== 'yes' || summary.overdue) && (!filters.recovery || filters.recovery !== 'yes' || summary.recoveryAttention) &&
    (!filters.opportunityResult || opportunityResult(request.opportunity) === filters.opportunityResult) && (!filters.projectStatus || request.project?.status === filters.projectStatus) &&
    matchesDateRange(summary.expected, filters.expectedFrom, filters.expectedTo);
}
export function matchesDemoReportUnit(item: { retiredAt?: Date | null; productSkuId: number | null; productSku: { product: { id: number } } | null }, unit: UnitState, filters: DemoReportFilters) {
  return (!item.retiredAt || !!unit.deployedAt) && (filters.state !== 'open' || !!unit.deployedAt && !unit.returnedAt) && (filters.state !== 'returned' || !!unit.returnedAt) &&
    matchesId(filters.productId, item.productSku?.product.id ?? null) && matchesId(filters.skuId, item.productSkuId) && matchesDateRange(unit.deployedAt, filters.deployedFrom, filters.deployedTo);
}
