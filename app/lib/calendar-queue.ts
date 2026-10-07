import type { Prisma } from '@prisma/client';

export type CalendarQueueStatus = 'review' | 'matched' | 'suggested' | 'unmatched' | 'upcoming' | 'logged' | 'ignored' | 'cancelled';
export function calendarQueueWhere(input: { userId: number; from: Date; to: Date; now: Date; status: CalendarQueueStatus; search?: string; accountId?: number | null }): Prisma.GoogleCalendarEventWhereInput {
  const { userId, from, to, now, status, search, accountId } = input;
  const conditions: Prisma.GoogleCalendarEventWhereInput[] = [
    { userId, connection: { userId } },
    { OR: [{ startAt: { gte: from, lte: to } }, { startDate: { gte: from.toISOString().slice(0, 10), lte: to.toISOString().slice(0, 10) } }] },
  ];
  if (search?.trim()) conditions.push({ summary: { contains: search.trim().slice(0, 100), mode: 'insensitive' } });
  if (accountId && Number.isSafeInteger(accountId) && accountId > 0) conditions.push({ review: { OR: [{ selectionsConfirmed: true, selectedAccountId: accountId }, { selectionsConfirmed: false, suggestedAccountId: accountId }] } });
  if (status === 'logged') conditions.push({ review: { activityId: { not: null } } });
  else if (status === 'ignored') conditions.push({ review: { ignoredAt: { not: null } } });
  else if (status === 'cancelled') conditions.push({ OR: [{ status: 'CANCELLED' }, { cancelledAt: { not: null } }] });
  else {
    conditions.push({ status: { not: 'CANCELLED' }, cancelledAt: null, review: { activityId: null, ignoredAt: null, ...(status === 'matched' ? { matchStatus: 'MATCHED' } : status === 'suggested' ? { matchStatus: 'SUGGESTED' } : status === 'unmatched' ? { matchStatus: 'UNMATCHED' } : { matchStatus: { not: 'INTERNAL' } }) } });
    conditions.push(status === 'upcoming' ? { OR: [{ endAt: { gt: now } }, { endDate: { gt: now.toISOString().slice(0, 10) } }] } : { OR: [{ endAt: { lte: now } }, { endDate: { lte: now.toISOString().slice(0, 10) } }] });
  }
  return { AND: conditions };
}
