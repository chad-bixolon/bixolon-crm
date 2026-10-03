import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type SalesQuarter } from '@prisma/client';
import { can, opportunityScope, type Actor } from './authorization';
import { getSettings } from './configuration';
import { forecastForRep, quarterBounds } from './forecast';

export function newYorkWeek(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const day = new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day;
}

export function snapshotComparisonState(weeks: readonly string[]) {
  return weeks.length === 0 ? 'NONE' : weeks.length === 1 ? 'ONE' : 'READY';
}

type SnapshotMetric = 'pipeline' | 'weightedPipeline' | 'bestCase' | 'commit' | 'target';
export function snapshotChange(rows: { snapshotWeek: Date; pipeline: Prisma.Decimal; weightedPipeline: Prisma.Decimal; bestCase: Prisma.Decimal; commit: Prisma.Decimal; target: Prisma.Decimal | null }[], previousWeek: string, currentWeek: string, key: SnapshotMetric) {
  const sum = (week: string) => rows.filter(row => row.snapshotWeek.toISOString().slice(0, 10) === week).reduce((value, row) => value.add(row[key] ?? 0), new Prisma.Decimal(0));
  const previous = sum(previousWeek), current = sum(currentWeek), change = current.sub(previous);
  return { previous, current, change, percent: previous.isZero() ? null : change.div(previous).mul(100).toDecimalPlaces(1) };
}

export function stageStartedAt(events: { eventType: string; occurredAt: Date }[]) {
  return events.find(event => event.eventType === 'STAGE' || event.eventType === 'BASELINE')?.occurredAt ?? null;
}

export function closeDateMovement(oldDate: Date | null, newDate: Date | null) {
  if (!oldDate || !newDate) return 'Date added or cleared';
  const period = (date: Date) => [date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3)];
  const oldPeriod = period(oldDate), newPeriod = period(newDate);
  if (newPeriod[0] > oldPeriod[0]) return 'Moved to a future year';
  if (newPeriod[0] === oldPeriod[0] && newPeriod[1] > oldPeriod[1]) return 'Slipped to a later quarter';
  if (newDate < oldDate) return 'Moved earlier';
  if (newDate > oldDate) return 'Moved later within the same quarter';
  return 'Same date';
}

export async function opportunityHistory(client: PrismaClient, actor: Actor, opportunityId: number, page = 1) {
  if (!can(actor, 'opportunities.read')) throw new Error('Access denied');
  const opportunity = await client.opportunity.findFirst({ where: { id: opportunityId, ...opportunityScope(actor) }, select: { id: true } });
  if (!opportunity) throw new Error('Opportunity not found');
  const skip = (Math.max(1, Math.min(page, 10000)) - 1) * 20;
  const [rows, archived, total, archiveTotal] = await Promise.all([
    client.opportunityHistoryEvent.findMany({ where: { opportunityId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip, take: 20 }),
    client.opportunityHistoryArchive.findMany({ where: { opportunityId }, orderBy: [{ occurredAt: 'desc' }, { sourceId: 'desc' }], skip: Math.max(0, skip - await client.opportunityHistoryEvent.count({ where: { opportunityId } })), take: 20 }),
    client.opportunityHistoryEvent.count({ where: { opportunityId } }),
    client.opportunityHistoryArchive.count({ where: { opportunityId } }),
  ]);
  const combined = rows.length < 20 ? [...rows, ...archived.slice(0, 20 - rows.length)] : rows;
  return { rows: combined, total: total + archiveTotal };
}

export async function captureForecastWeek(client: PrismaClient, actor: Actor, input: { year: number; quarter: SalesQuarter; currencyCode: string; at?: Date }) {
  if (actor.role !== 'ADMIN' || !can(actor, 'sales.read')) throw new Error('Access denied');
  quarterBounds(input.year, input.quarter);
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) throw new Error('Invalid currency');
  const at = input.at ?? new Date(), snapshotWeek = newYorkWeek(at);
  const users = await client.user.findMany({ where: { active: true, archivedAt: null, role: { in: ['SALES', 'SALES_MANAGER'] } }, select: { id: true, firstName: true, lastName: true } });
  const archived = users.length ? await client.forecastSnapshotArchive.findMany({ where: { snapshotWeek, year: input.year, quarter: input.quarter, currencyCode: input.currencyCode, repId: { in: users.map(user => user.id) } }, select: { repId: true } }) : [];
  const archivedRepIds = new Set(archived.map(row => row.repId));
  const rows: Prisma.ForecastSnapshotCreateManyInput[] = [];
  for (const user of users) {
    if (archivedRepIds.has(user.id)) continue;
    const metrics = await forecastForRep(client, actor, { userId: user.id, year: input.year, quarter: input.quarter, currencyCode: input.currencyCode });
    rows.push({ snapshotWeek, capturedAt: at, year: input.year, quarter: input.quarter, currencyCode: input.currencyCode, repId: user.id, repName: `${user.firstName} ${user.lastName}`, pipeline: metrics.pipeline, weightedPipeline: metrics.weightedPipeline, bestCase: metrics.bestCase, commit: metrics.commit, target: metrics.target, targetStatus: metrics.targetStatus });
  }
  const created = rows.length ? (await client.forecastSnapshot.createMany({ data: rows, skipDuplicates: true })).count : 0;
  return { snapshotWeek, created, eligibleReps: users.length };
}

export async function restoreHistoryBatch(client: PrismaClient, actor: Actor, batchId: string) {
  if (actor.role !== 'ADMIN' || !can(actor, 'users.manage') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) throw new Error('Access denied or invalid batch');
  return client.$transaction(async tx => {
    const [events, snapshots] = await Promise.all([
      tx.opportunityHistoryArchive.findMany({ where: { archiveBatchId: batchId }, take: 1001 }),
      tx.forecastSnapshotArchive.findMany({ where: { archiveBatchId: batchId }, take: 1001 }),
    ]);
    if (!events.length && !snapshots.length) throw new Error('Archive batch not found');
    if (events.length > 1000 || snapshots.length > 1000) throw new Error('Archive batch exceeds restore limit');
    const [eventConflicts, snapshotIdConflicts, scopeConflicts] = await Promise.all([
      events.length ? tx.opportunityHistoryEvent.count({ where: { id: { in: events.map(row => row.sourceId) } } }) : 0,
      snapshots.length ? tx.forecastSnapshot.count({ where: { id: { in: snapshots.map(row => row.sourceId) } } }) : 0,
      snapshots.length ? tx.forecastSnapshot.count({ where: { OR: snapshots.map(row => ({ snapshotWeek: row.snapshotWeek, year: row.year, quarter: row.quarter, currencyCode: row.currencyCode, repId: row.repId })) } }) : 0,
    ]);
    if (eventConflicts || snapshotIdConflicts || scopeConflicts) throw new Error('Restore conflicts with active history. No rows were moved.');
    const eventData = events.map(({ id: archiveId, sourceId, archivedAt, archiveBatchId, ...row }) => { void archiveId; void archivedAt; void archiveBatchId; return { ...row, id: sourceId }; });
    const snapshotData = snapshots.map(({ id: archiveId, sourceId, archivedAt, archiveBatchId, ...row }) => { void archiveId; void archivedAt; void archiveBatchId; return { ...row, id: sourceId }; });
    if (events.length) {
      const copied = await tx.opportunityHistoryEvent.createMany({ data: eventData });
      if (copied.count !== events.length) throw new Error('Event restore count mismatch');
      const removed = await tx.opportunityHistoryArchive.deleteMany({ where: { id: { in: events.map(row => row.id) } } });
      if (removed.count !== events.length) throw new Error('Event archive cleanup count mismatch');
    }
    if (snapshots.length) {
      const copied = await tx.forecastSnapshot.createMany({ data: snapshotData });
      if (copied.count !== snapshots.length) throw new Error('Snapshot restore count mismatch');
      const removed = await tx.forecastSnapshotArchive.deleteMany({ where: { id: { in: snapshots.map(row => row.id) } } });
      if (removed.count !== snapshots.length) throw new Error('Snapshot archive cleanup count mismatch');
    }
    return { batchId, events: events.length, snapshots: snapshots.length };
  });
}

export function archiveCutoff(now: Date, years: number) {
  const date = new Date(now); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(date.getUTCFullYear() - years); return date;
}

export async function previewHistoryArchive(client: PrismaClient, actor: Actor, now = new Date()) {
  if (actor.role !== 'ADMIN' || !can(actor, 'users.manage')) throw new Error('Access denied');
  const years = (await getSettings(client)).HISTORY_RETENTION_YEARS, cutoff = archiveCutoff(now, years);
  const [events, snapshots, firstEvent, lastEvent, firstSnapshot, lastSnapshot] = await Promise.all([
    client.opportunityHistoryEvent.count({ where: { occurredAt: { lt: cutoff } } }),
    client.forecastSnapshot.count({ where: { capturedAt: { lt: cutoff } } }),
    client.opportunityHistoryEvent.findFirst({ where: { occurredAt: { lt: cutoff } }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
    client.opportunityHistoryEvent.findFirst({ where: { occurredAt: { lt: cutoff } }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    client.forecastSnapshot.findFirst({ where: { capturedAt: { lt: cutoff } }, orderBy: { capturedAt: 'asc' }, select: { capturedAt: true } }),
    client.forecastSnapshot.findFirst({ where: { capturedAt: { lt: cutoff } }, orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } }),
  ]);
  return { years, cutoff, events, snapshots, firstEvent: firstEvent?.occurredAt ?? null, lastEvent: lastEvent?.occurredAt ?? null, firstSnapshot: firstSnapshot?.capturedAt ?? null, lastSnapshot: lastSnapshot?.capturedAt ?? null };
}

// Each bounded batch is copied, checked and removed in one database transaction.
export async function archiveHistoryBatch(client: PrismaClient, actor: Actor, cutoff: Date, limit = 500) {
  if (actor.role !== 'ADMIN' || !can(actor, 'users.manage')) throw new Error('Access denied');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid batch size');
  const eligible = archiveCutoff(new Date(), (await getSettings(client)).HISTORY_RETENTION_YEARS);
  if (cutoff.getTime() > eligible.getTime()) throw new Error('Cutoff exceeds retention policy');
  const batch = randomUUID(), archivedAt = new Date();
  return client.$transaction(async tx => {
    const [events, snapshots] = await Promise.all([
      tx.opportunityHistoryEvent.findMany({ where: { occurredAt: { lt: cutoff } }, orderBy: { id: 'asc' }, take: limit }),
      tx.forecastSnapshot.findMany({ where: { capturedAt: { lt: cutoff } }, orderBy: { id: 'asc' }, take: limit }),
    ]);
    const eventData = events.map(({ id, ...row }) => ({ ...row, sourceId: id, archivedAt, archiveBatchId: batch }));
    const snapshotData = snapshots.map(({ id, ...row }) => ({ ...row, sourceId: id, archivedAt, archiveBatchId: batch }));
    if (events.length) {
      const inserted = await tx.opportunityHistoryArchive.createMany({ data: eventData });
      if (inserted.count !== events.length) throw new Error('History archive count mismatch');
      const removed = await tx.opportunityHistoryEvent.deleteMany({ where: { id: { in: events.map(row => row.id) } } });
      if (removed.count !== events.length) throw new Error('History removal count mismatch');
    }
    if (snapshots.length) {
      const inserted = await tx.forecastSnapshotArchive.createMany({ data: snapshotData });
      if (inserted.count !== snapshots.length) throw new Error('Snapshot archive count mismatch');
      const removed = await tx.forecastSnapshot.deleteMany({ where: { id: { in: snapshots.map(row => row.id) } } });
      if (removed.count !== snapshots.length) throw new Error('Snapshot removal count mismatch');
    }
    return { batch, events: events.length, snapshots: snapshots.length };
  });
}
