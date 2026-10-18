import type { OperationalFailure } from './integration-attempts';

export class CalendarRequestFailure extends Error {
  constructor(public readonly category: OperationalFailure) { super('Calendar request did not complete.'); }
}
export function calendarFailure(error: unknown): OperationalFailure {
  return error instanceof CalendarRequestFailure ? error.category : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'NETWORK' : 'UNKNOWN';
}
export function calendarHttpFailure(status: number): OperationalFailure {
  return status === 401 ? 'AUTHENTICATION' : status === 403 ? 'PERMISSION' : status === 429 ? 'RATE_LIMIT' : status === 404 ? 'NOT_FOUND' : status >= 500 ? 'PROVIDER' : 'UNKNOWN';
}
export const CALENDAR_REQUEST_MS = 10000;
/** No automatic request retries. Sync-token recovery is separately bounded to once. */
export async function calendarRequest(fetcher: typeof fetch, url: string, init: RequestInit) {
  try { return await fetcher(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(CALENDAR_REQUEST_MS)]) : AbortSignal.timeout(CALENDAR_REQUEST_MS) }); }
  catch { throw new CalendarRequestFailure('NETWORK'); }
}
