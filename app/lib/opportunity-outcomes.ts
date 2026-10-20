import type { Prisma } from '@prisma/client';

export const OUTCOME_NOTES_LIMIT = 2000;
export type OutcomeFields = { actualCloseDate?: Date | null; outcomeReasonId?: number | null; outcomeReasonName?: string | null; outcomeNotes?: string | null };
type Stage = { isClosed: boolean; isWon: boolean };
type Previous = OutcomeFields & { stage: Stage };
export type OutcomeReasonValue = { id: number; name: string; isWon: boolean; active: boolean };

/** A date-only value, with no browser/user timezone conversion. */
export function parseActualCloseDate(raw: string): Date | null {
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw || date.getUTCFullYear() < 1) throw new Error('Choose a valid Actual Close Date.');
  return date;
}

export function resolveOpportunityOutcome(stage: Stage, input: OutcomeFields, existing: Previous | null, reason: OutcomeReasonValue | null) {
  const empty = { actualCloseDate: null, outcomeReasonId: null, outcomeReasonName: null, outcomeNotes: null };
  if (!stage.isClosed) return empty;
  const actualCloseDate = input.actualCloseDate ?? null, outcomeReasonId = input.outcomeReasonId ?? null, outcomeNotes = input.outcomeNotes?.trim() || null;
  if (actualCloseDate && (Number.isNaN(actualCloseDate.getTime()) || actualCloseDate.getUTCFullYear() < 1)) throw new Error('Choose a valid Actual Close Date.');
  if (outcomeNotes && outcomeNotes.length > OUTCOME_NOTES_LIMIT) throw new Error(`Outcome Notes must be ${OUTCOME_NOTES_LIMIT} characters or fewer.`);
  const sameState = !!existing?.stage.isClosed && existing.stage.isWon === stage.isWon;
  const unchanged = sameState && (existing.actualCloseDate?.toISOString().slice(0, 10) ?? null) === (actualCloseDate?.toISOString().slice(0, 10) ?? null) && (existing.outcomeReasonId ?? null) === outcomeReasonId && (existing.outcomeNotes ?? null) === outcomeNotes;
  // Legacy unknown fields may remain unknown during unrelated edits.
  if (!unchanged) {
    if (!actualCloseDate) throw new Error('Enter an Actual Close Date before closing or updating the outcome.');
    const retained = sameState && existing?.outcomeReasonId === outcomeReasonId;
    if (!reason || reason.isWon !== stage.isWon || (!reason.active && !retained)) throw new Error(`Choose an active Closed ${stage.isWon ? 'Won' : 'Lost'} Outcome Reason.`);
  }
  if (!sameState && (!actualCloseDate || !reason?.active || reason.isWon !== stage.isWon)) throw new Error('Enter an Actual Close Date and choose an active Outcome Reason before closing.');
  const outcomeReasonName = sameState && existing?.outcomeReasonId === outcomeReasonId ? existing.outcomeReasonName ?? reason?.name ?? null : reason?.name ?? null;
  return { actualCloseDate, outcomeReasonId, outcomeReasonName, outcomeNotes };
}

/** Full immutable context for close, reopen and corrections, also copied by history archival. */
export function outcomeHistoryValue(fields: OutcomeFields, stage: Stage): Prisma.InputJsonObject {
  return { status: stage.isClosed ? (stage.isWon ? 'Closed Won' : 'Closed Lost') : 'Open', actualCloseDate: fields.actualCloseDate?.toISOString().slice(0, 10) ?? null, outcomeReasonId: fields.outcomeReasonId ?? null, outcomeReason: fields.outcomeReasonName ?? null, outcomeNotes: fields.outcomeNotes ?? null };
}
export function outcomeHistoryText(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'No recorded outcome';
  return `${value.status} · Actual Close Date: ${value.actualCloseDate ?? 'Unknown'} · Outcome Reason: ${value.outcomeReason ?? 'Unknown'}${value.outcomeNotes ? ` · Outcome Notes: ${value.outcomeNotes}` : ''}`;
}

export type OutcomeFilters = { actualCloseFrom?: string; actualCloseTo?: string; outcomeStatus?: string; outcomeReasonId?: string };
/** Compose with owner and authorization scopes in opportunityWhere/listOpportunities. */
export function opportunityOutcomeWhere(filters: OutcomeFilters): Prisma.OpportunityWhereInput {
  const where: Prisma.OpportunityWhereInput = {};
  if (filters.outcomeStatus === 'open') where.stage = { isClosed: false };
  if (filters.outcomeStatus === 'won' || filters.outcomeStatus === 'lost') where.stage = { isClosed: true, isWon: filters.outcomeStatus === 'won' };
  const from = parseActualCloseDate(filters.actualCloseFrom ?? ''), to = parseActualCloseDate(filters.actualCloseTo ?? '');
  if (from && to && from > to) throw new Error('Actual Close Date range must end on or after its start.');
  if (from || to) where.actualCloseDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (filters.outcomeReasonId) {
    if (!/^[1-9]\d*$/.test(filters.outcomeReasonId) || !Number.isSafeInteger(Number(filters.outcomeReasonId))) throw new Error('Choose a valid Outcome Reason.');
    where.outcomeReasonId = Number(filters.outcomeReasonId);
  }
  return where;
}
