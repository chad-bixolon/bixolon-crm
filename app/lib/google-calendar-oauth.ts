import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { decryptCalendarToken, encryptCalendarToken } from './calendar-crypto';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const CALENDAR_STATE_COOKIE = 'saleshub-calendar-oauth-state';
const stateLifetimeMs = 10 * 60 * 1000;

export function realCalendarUserId(real: { id: number; active: boolean } | null | undefined) {
  if (!real?.active || !Number.isSafeInteger(real.id) || real.id < 1) throw new Error('Sign in to manage Google Calendar.');
  return real.id;
}

function authSecret() {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is required for Calendar OAuth state.');
  return process.env.AUTH_SECRET;
}

export function calendarRedirectUri() {
  const origin = process.env.AUTH_URL;
  if (!origin) throw new Error('AUTH_URL is required for Calendar OAuth.');
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) throw new Error('Calendar OAuth requires HTTPS or localhost.');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('AUTH_URL must be an origin.');
  return new URL('/api/calendar/callback', url).toString();
}

export function createCalendarState(userId: number, now = Date.now()) {
  const value = `${userId}.${now}.${randomBytes(32).toString('base64url')}`;
  const signature = createHmac('sha256', authSecret()).update(value).digest('base64url');
  return `${value}.${signature}`;
}

export function validateCalendarState(state: string | null, cookie: string | undefined, realUserId: number, now = Date.now()) {
  if (!state || !cookie || state !== cookie) return false;
  const parts = state.split('.');
  if (parts.length !== 4 || parts[0] !== String(realUserId)) return false;
  const issued = Number(parts[1]);
  if (!Number.isSafeInteger(issued) || issued > now || now - issued > stateLifetimeMs) return false;
  const expected = createHmac('sha256', authSecret()).update(parts.slice(0, 3).join('.')).digest();
  const actual = Buffer.from(parts[3], 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function calendarAuthorizationUrl(state: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: process.env.AUTH_GOOGLE_ID ?? '', redirect_uri: calendarRedirectUri(), response_type: 'code', scope: `openid email profile ${CALENDAR_SCOPE}`, access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent', state }).toString();
  if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) throw new Error('Google OAuth client credentials are required.');
  return url.toString();
}

type GoogleTokenResponse = { access_token?: string; refresh_token?: string; scope?: string; token_type?: string };
export async function exchangeCalendarCode(code: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: process.env.AUTH_GOOGLE_ID ?? '', client_secret: process.env.AUTH_GOOGLE_SECRET ?? '', redirect_uri: calendarRedirectUri(), grant_type: 'authorization_code' }), cache: 'no-store' });
  if (!response.ok) throw new Error('Calendar OAuth token exchange failed.');
  const token = await response.json() as GoogleTokenResponse;
  if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer' || !token.scope?.split(/\s+/).includes(CALENDAR_SCOPE)) throw new Error('Calendar read permission was not granted.');
  return token;
}

export async function calendarGoogleIdentity(accessToken: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  if (!response.ok) throw new Error('Could not verify Google account.');
  const profile = await response.json() as { sub?: string; email?: string; email_verified?: boolean };
  if (!profile.sub || !profile.email || profile.email_verified !== true) throw new Error('Google account identity is unavailable.');
  return { googleAccountId: profile.sub, googleEmail: profile.email };
}

export async function storeCalendarConnection(client: Pick<PrismaClient, 'externalIdentity' | 'googleCalendarConnection'>, realUserId: number, identity: { googleAccountId: string; googleEmail: string }, token: GoogleTokenResponse) {
  const loginIdentity = await client.externalIdentity.findFirst({ where: { userId: realUserId, provider: 'GOOGLE', issuer: 'https://accounts.google.com', subject: identity.googleAccountId }, select: { id: true } });
  if (!loginIdentity) throw new Error('Connect the Google account used for SalesHub sign-in.');
  const existing = await client.googleCalendarConnection.findUnique({ where: { userId: realUserId }, select: { googleAccountId: true, refreshTokenEncrypted: true } });
  const refreshTokenEncrypted = token.refresh_token ? encryptCalendarToken(token.refresh_token) : existing?.googleAccountId === identity.googleAccountId ? existing.refreshTokenEncrypted : null;
  if (!refreshTokenEncrypted) throw new Error('Google did not provide offline access. Please reauthorize.');
  if (!token.scope?.split(/\s+/).includes(CALENDAR_SCOPE)) throw new Error('Calendar read permission was not granted.');
  const data = { googleAccountId: identity.googleAccountId, googleEmail: identity.googleEmail, refreshTokenEncrypted, grantedScopes: token.scope, connectionStatus: 'CONNECTED' as const, lastConnectedAt: new Date(), lastError: null };
  await client.googleCalendarConnection.upsert({ where: { userId: realUserId }, create: { userId: realUserId, ...data }, update: data });
}

export async function disconnectCalendar(client: Pick<PrismaClient, 'googleCalendarConnection'>, realUserId: number) {
  await client.googleCalendarConnection.deleteMany({ where: { userId: realUserId } });
}

// Server-only preparation for a later sync worker. Callers must never serialize the returned token.
export async function refreshCalendarAccessToken(client: Pick<PrismaClient, 'googleCalendarConnection'>, realUserId: number, fetcher: typeof fetch = fetch) {
  const connection = await client.googleCalendarConnection.findUnique({ where: { userId: realUserId }, select: { refreshTokenEncrypted: true, connectionStatus: true } });
  if (!connection || connection.connectionStatus !== 'CONNECTED') return null;
  let refreshToken: string;
  try { refreshToken = decryptCalendarToken(connection.refreshTokenEncrypted); }
  catch {
    await client.googleCalendarConnection.updateMany({ where: { userId: realUserId }, data: { connectionStatus: 'NEEDS_REAUTH', lastError: 'Stored credential could not be read.' } });
    return null;
  }
  let response: Response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.AUTH_GOOGLE_ID ?? '', client_secret: process.env.AUTH_GOOGLE_SECRET ?? '', refresh_token: refreshToken, grant_type: 'refresh_token' }), cache: 'no-store' });
  } catch { return null; }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    if (error?.error === 'invalid_grant') await client.googleCalendarConnection.updateMany({ where: { userId: realUserId }, data: { connectionStatus: 'NEEDS_REAUTH', lastError: 'Google authorization expired or was revoked.' } });
    return null;
  }
  let token: GoogleTokenResponse;
  try { token = await response.json() as GoogleTokenResponse; } catch { return null; }
  if (!token.access_token || (token.scope && !token.scope.split(/\s+/).includes(CALENDAR_SCOPE))) {
    await client.googleCalendarConnection.updateMany({ where: { userId: realUserId }, data: { connectionStatus: 'NEEDS_REAUTH', lastError: 'Calendar read permission is unavailable.' } });
    return null;
  }
  return token.access_token;
}
