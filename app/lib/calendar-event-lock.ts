import type { Prisma } from '@prisma/client';

// GoogleCalendarEvent.id and GoogleCalendarEventReview.eventId are PostgreSQL INTEGER.
// Prisma binds JavaScript numbers in raw SQL as BIGINT, so both arguments must
// explicitly use the (integer, integer) advisory-lock overload.
export async function lockCalendarEvent(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, eventId: number) {
  if (!Number.isInteger(eventId) || eventId < 1 || eventId > 2147483647) throw new Error('Invalid Calendar event ID.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(726234013::integer, ${eventId}::integer)`;
}
