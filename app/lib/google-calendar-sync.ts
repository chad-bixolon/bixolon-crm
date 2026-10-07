import type { PrismaClient } from '@prisma/client';
import { refreshCalendarAccessToken } from './google-calendar-oauth';

export const INITIAL_PAST_DAYS = 60;
export const INITIAL_FUTURE_DAYS = 90;
const PAGE_SIZE = 250;
const LEASE_MS = 30 * 60 * 1000;
type Client = Pick<PrismaClient, 'googleCalendarConnection' | 'googleCalendarEvent'>;
type GoogleTime = { date?: string; dateTime?: string; timeZone?: string };
type GoogleEvent = {
  id?: string; status?: string; iCalUID?: string; summary?: string; location?: string; htmlLink?: string;
  hangoutLink?: string; organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean }[];
  start?: GoogleTime; end?: GoogleTime; created?: string; updated?: string;
  recurringEventId?: string; originalStartTime?: GoogleTime; visibility?: string; transparency?: string;
};
type GooglePage = { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
export type CalendarSyncResult = { connectionId: number; mode: 'INITIAL' | 'INCREMENTAL' | 'RECOVERY'; processed: number; inserted: number; updated: number; cancelled: number; success: boolean; reason?: 'busy' | 'reauth' | 'failed' };

function dateOrNull(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function initialCalendarWindow(now: Date) {
  return { timeMin: new Date(now.getTime() - INITIAL_PAST_DAYS * 86400000).toISOString(), timeMax: new Date(now.getTime() + INITIAL_FUTURE_DAYS * 86400000).toISOString() };
}

function originalStart(time?: GoogleTime) { return time?.dateTime ?? time?.date ?? null; }

export async function upsertGoogleCalendarEvent(client: Client, connection: { id: number; userId: number; primaryCalendarId: string }, event: GoogleEvent, now: Date) {
  if (!event.id) throw new Error('Google Calendar returned an event without an ID.');
  const where = { connectionId_googleCalendarId_googleEventId: { connectionId: connection.id, googleCalendarId: connection.primaryCalendarId, googleEventId: event.id } };
  const existing = await client.googleCalendarEvent.findUnique({ where, select: { id: true, cancelledAt: true } });
  const cancelled = event.status === 'cancelled';
  // Deleted events can contain only an ID. Preserve the last known details and attendees.
  if (cancelled) {
    if (existing) await client.googleCalendarEvent.update({ where, data: { status: 'CANCELLED', cancelledAt: existing.cancelledAt ?? now, syncedAt: now } });
    else await client.googleCalendarEvent.create({ data: { connectionId: connection.id, userId: connection.userId, googleCalendarId: connection.primaryCalendarId, googleEventId: event.id, status: 'CANCELLED', cancelledAt: now, syncedAt: now, recurringEventId: event.recurringEventId ?? null, originalStartTime: originalStart(event.originalStartTime) } });
    return { inserted: !existing, cancelled: true };
  }
  const attendees = [...new Map((event.attendees ?? []).filter(a => a.email?.trim()).map(a => [a.email!.trim().toLowerCase(), { email: a.email!.trim(), normalizedEmail: a.email!.trim().toLowerCase(), displayName: a.displayName ?? null, responseStatus: a.responseStatus ?? null, organizer: !!a.organizer, self: !!a.self }])).values()];
  const data = {
    googleICalUid: event.iCalUID ?? null, status: event.status?.toUpperCase() ?? 'CONFIRMED',
    summary: event.summary ?? null, location: event.location ?? null, htmlLink: event.htmlLink ?? null, hangoutLink: event.hangoutLink ?? null,
    organizerEmail: event.organizer?.email ?? null, organizerDisplayName: event.organizer?.displayName ?? null,
    startAt: dateOrNull(event.start?.dateTime), endAt: dateOrNull(event.end?.dateTime),
    startTimeZone: event.start?.timeZone ?? null, endTimeZone: event.end?.timeZone ?? null,
    allDay: !!event.start?.date, startDate: event.start?.date ?? null, endDate: event.end?.date ?? null,
    googleCreatedAt: dateOrNull(event.created), googleUpdatedAt: dateOrNull(event.updated),
    recurringEventId: event.recurringEventId ?? null, originalStartTime: originalStart(event.originalStartTime),
    visibility: event.visibility ?? null, transparency: event.transparency ?? null, cancelledAt: null, syncedAt: now,
  };
  await client.googleCalendarEvent.upsert({ where, create: { ...data, connectionId: connection.id, userId: connection.userId, googleCalendarId: connection.primaryCalendarId, googleEventId: event.id, attendees: { create: attendees } }, update: { ...data, attendees: { deleteMany: {}, create: attendees } } });
  return { inserted: !existing, cancelled: false };
}

class ExpiredSyncToken extends Error {}
async function listPage(accessToken: string, calendarId: string, query: URLSearchParams, fetcher: typeof fetch) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`;
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  if (response.status === 410) throw new ExpiredSyncToken();
  if (!response.ok) throw new Error(`Google Calendar events.list returned HTTP ${response.status}.`);
  const page = await response.json() as GooglePage;
  if (page.items !== undefined && !Array.isArray(page.items)) throw new Error('Google Calendar returned an invalid event page.');
  return page;
}

async function runPages(client: Client, connection: { id: number; userId: number; primaryCalendarId: string }, accessToken: string, mode: CalendarSyncResult['mode'], token: string | null, now: Date, fetcher: typeof fetch) {
  const query = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: String(PAGE_SIZE) });
  if (token) query.set('syncToken', token);
  else { const window = initialCalendarWindow(now); query.set('timeMin', window.timeMin); query.set('timeMax', window.timeMax); }
  const result: CalendarSyncResult = { connectionId: connection.id, mode, processed: 0, inserted: 0, updated: 0, cancelled: 0, success: true };
  const seenPages = new Set<string>();
  const seenEvents = new Set<string>();
  let nextToken: string | undefined;
  for (;;) {
    const page = await listPage(accessToken, connection.primaryCalendarId, query, fetcher);
    for (const event of page.items ?? []) {
      const applied = await upsertGoogleCalendarEvent(client, connection, event, now);
      seenEvents.add(event.id!);
      result.processed++;
      result.inserted += Number(applied.inserted);
      result.updated += Number(!applied.inserted);
      result.cancelled += Number(applied.cancelled);
    }
    if (page.nextPageToken) {
      if (seenPages.has(page.nextPageToken)) throw new Error('Google Calendar repeated a page token.');
      seenPages.add(page.nextPageToken);
      query.set('pageToken', page.nextPageToken);
    } else {
      nextToken = page.nextSyncToken;
      break;
    }
  }
  if (!nextToken) throw new Error('Google Calendar did not return a final sync token.');
  return { result, nextToken, seenEvents };
}

export async function syncGoogleCalendarConnection(client: Client, connectionId: number, fetcher: typeof fetch = fetch, now = new Date()): Promise<CalendarSyncResult> {
  const connection = await client.googleCalendarConnection.findUnique({ where: { id: connectionId }, select: { id: true, userId: true, primaryCalendarId: true, syncToken: true, connectionStatus: true } });
  const blank: CalendarSyncResult = { connectionId, mode: connection?.syncToken ? 'INCREMENTAL' : 'INITIAL', processed: 0, inserted: 0, updated: 0, cancelled: 0, success: false };
  if (!connection || connection.connectionStatus !== 'CONNECTED') return { ...blank, reason: 'reauth' };
  const startedAt = now;
  const claimed = await client.googleCalendarConnection.updateMany({ where: { id: connectionId, connectionStatus: 'CONNECTED', OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: now } }] }, data: { syncLeaseUntil: new Date(now.getTime() + LEASE_MS), lastSyncStartedAt: startedAt } });
  if (!claimed.count) return { ...blank, reason: 'busy' };
  try {
    const accessToken = await refreshCalendarAccessToken(client, connection.userId, fetcher);
    if (!accessToken) {
      const current = await client.googleCalendarConnection.findUnique({ where: { id: connectionId }, select: { connectionStatus: true } });
      throw new Error(current?.connectionStatus === 'NEEDS_REAUTH' ? 'reauth' : 'credential');
    }
    let result: Awaited<ReturnType<typeof runPages>>;
    try { result = await runPages(client, connection, accessToken, blank.mode, connection.syncToken, now, fetcher); }
    catch (error) {
      if (!(error instanceof ExpiredSyncToken) || !connection.syncToken) throw error;
      await client.googleCalendarConnection.updateMany({ where: { id: connectionId, lastSyncStartedAt: startedAt }, data: { syncToken: null } });
      result = await runPages(client, connection, accessToken, 'RECOVERY', null, now, fetcher);
    }
    if (result.result.mode !== 'INCREMENTAL') {
      const window = initialCalendarWindow(now);
      // A fresh bounded snapshot can omit events removed before it began. Keep their
      // history, but make in-window rows absent from the snapshot ineligible for review.
      const missing = await client.googleCalendarEvent.updateMany({ where: {
        connectionId, status: { not: 'CANCELLED' }, googleEventId: { notIn: [...result.seenEvents] },
        OR: [
          { startAt: { lt: new Date(window.timeMax) }, endAt: { gt: new Date(window.timeMin) } },
          { startDate: { lt: window.timeMax.slice(0, 10) }, endDate: { gt: window.timeMin.slice(0, 10) } },
        ],
      }, data: { status: 'CANCELLED', cancelledAt: now, syncedAt: now } });
      result.result.cancelled += missing.count;
    }
    const completedAt = new Date();
    const saved = await client.googleCalendarConnection.updateMany({ where: { id: connectionId, lastSyncStartedAt: startedAt, connectionStatus: 'CONNECTED' }, data: { syncToken: result.nextToken, lastSuccessfulSyncAt: completedAt, lastSyncCompletedAt: completedAt, syncLeaseUntil: null, lastError: null } });
    if (!saved.count) throw new Error('Calendar connection changed while syncing.');
    return result.result;
  } catch (error) {
    const reason = error instanceof Error && error.message === 'reauth' ? 'reauth' : 'failed';
    const message = reason === 'reauth' ? 'Google authorization expired or was revoked.' : 'Calendar sync failed. Retry later.';
    await client.googleCalendarConnection.updateMany({ where: { id: connectionId, lastSyncStartedAt: startedAt }, data: { syncLeaseUntil: null, lastSyncCompletedAt: new Date(), lastError: message } });
    return { ...blank, reason };
  }
}

export async function syncAllGoogleCalendarConnections(client: Client, fetcher: typeof fetch = fetch) {
  const connections = await client.googleCalendarConnection.findMany({ where: { connectionStatus: 'CONNECTED', user: { active: true, archivedAt: null } }, select: { id: true } });
  const results: CalendarSyncResult[] = [];
  for (const connection of connections) results.push(await syncGoogleCalendarConnection(client, connection.id, fetcher));
  return results;
}
