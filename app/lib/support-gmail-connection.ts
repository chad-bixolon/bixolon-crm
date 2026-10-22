import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { decryptSupportGmailToken, encryptSupportGmailToken, supportGmailEncryptionKey as encryptionKey } from './support-gmail-crypto';
import { can, type Actor } from './authorization';
import { SUPPORT_GMAIL_SCOPE, supportGmailCallback, assertLiveSupportGmailEnvironment, supportGmailMockMode, supportGmailTestFixtureMode } from './support-gmail-config';

export const SUPPORT_GMAIL_STATE_COOKIE = 'saleshub-support-gmail-oauth-state';
export const SUPPORT_GMAIL_VERIFIER_COOKIE = 'saleshub-support-gmail-oauth-verifier';
export function supportGmailCookieOptions() { return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/api/support-gmail/callback', maxAge: 600 }; }
type StoredConnection = { email: string; connectedAt: string; refreshToken: string; scope: string };
type ConnectionDb = Pick<PrismaClient, 'supportGmailConnection'>;
const connectionDb = async (): Promise<Pick<PrismaClient, 'supportGmailConnection' | 'scheduledJobRun'>> => (await import('./prisma')).prisma;
const usedStates = new Map<string, number>();
const lifetime = 600000;

function assertOAuthAvailable() {
  assertLiveSupportGmailEnvironment();
  if (supportGmailMockMode() || supportGmailTestFixtureMode()) throw new Error('Gmail OAuth is disabled in fixture mode.');
}
export function supportGmailClientConfigured() {
  try { assertOAuthAvailable(); oauthSettings(); encryptionKey(); stateSecret(); assertExpectedMailbox(process.env.SUPPORT_GMAIL_MAILBOX || ''); return true; }
  catch { return false; }
}
function oauthSettings() {
  const clientId = process.env.SUPPORT_GMAIL_CLIENT_ID;
  const clientSecret = process.env.SUPPORT_GMAIL_CLIENT_SECRET;
  const callback = supportGmailCallback();
  if (!clientId || !clientSecret || clientId === process.env.AUTH_GOOGLE_ID) throw new Error('Dedicated Support Gmail OAuth client is required.');
  return { clientId, clientSecret, callback };
}
function stateSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required for Support Gmail OAuth.');
  return secret;
}
const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const validVerifier = (verifier: string | undefined): verifier is string => !!verifier && /^[A-Za-z0-9_-]{43,128}$/.test(verifier);
export function makeSupportGmailState(userId: number, now = Date.now(), verifier = randomBytes(32).toString('base64url')) {
  if (!Number.isSafeInteger(userId) || userId < 1 || !validVerifier(verifier)) throw new Error('Invalid Support Gmail authorization request.');
  const body = `${userId}.${now}.${pkceChallenge(verifier)}`;
  return `${body}.${createHmac('sha256', stateSecret()).update(body).digest('base64url')}`;
}
export function validSupportGmailState(value: string | null, cookie: string | undefined, userId: number, now = Date.now()) {
  if (!value || !cookie || value !== cookie || value.length > 256) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== String(userId)) return false;
  const issued = Number(parts[1]);
  if (!Number.isSafeInteger(issued) || issued > now || now - issued >= lifetime || !/^[A-Za-z0-9_-]{43}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) return false;
  const expected = createHmac('sha256', stateSecret()).update(parts.slice(0, 3).join('.')).digest();
  const actual = Buffer.from(parts[3], 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function consumeSupportGmailState(value: string | null, cookie: string | undefined, userId: number, verifier: string | undefined, now = Date.now()) {
  if (!validSupportGmailState(value, cookie, userId, now) || !validVerifier(verifier) || value!.split('.')[2] !== pkceChallenge(verifier)) return false;
  for (const [state, expiry] of usedStates) if (expiry <= now) usedStates.delete(state);
  if (usedStates.has(value!) || usedStates.size >= 256) return false;
  // Claim before awaiting Google. A duplicate callback cannot exchange concurrently.
  usedStates.set(value!, Number(value!.split('.')[1]) + lifetime);
  return true;
}
export function supportGmailAuthorizationUrl(state: string, verifier: string) {
  assertOAuthAvailable();
  encryptionKey();
  const { clientId, callback } = oauthSettings();
  if (!validVerifier(verifier)) throw new Error('Invalid Support Gmail authorization request.');
  assertExpectedMailbox(process.env.SUPPORT_GMAIL_MAILBOX || '');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: SUPPORT_GMAIL_SCOPE, access_type: 'offline', prompt: 'consent', login_hint: process.env.SUPPORT_GMAIL_MAILBOX!.trim(), state, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256' }).toString();
  return url.toString();
}
export function beginSupportGmailAuthorization(userId: number) {
  const verifier = randomBytes(32).toString('base64url');
  const state = makeSupportGmailState(userId, Date.now(), verifier);
  return { state, verifier, url: supportGmailAuthorizationUrl(state, verifier) };
}
export function verifyReadOnlyScope(scope: string | undefined) {
  if (scope !== SUPPORT_GMAIL_SCOPE) throw new Error('Google must grant only gmail.readonly.');
}
async function oauthFetch(url: string, init: RequestInit, fetcher: typeof fetch) {
  try { return await fetcher(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('Support Gmail authorization could not reach Google. Try again.'); }
}
export async function exchangeSupportGmailCode(code: string, verifier: string, fetcher: typeof fetch = fetch) {
  assertOAuthAvailable();
  if (!code || code.length > 4096 || !validVerifier(verifier)) throw new Error('Invalid Support Gmail authorization response.');
  const { clientId, clientSecret, callback } = oauthSettings();
  const response = await oauthFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret, redirect_uri: callback, grant_type: 'authorization_code' }) }, fetcher);
  if (!response.ok) throw new Error('Support Gmail OAuth exchange failed.');
  const token = await response.json() as { access_token?: string; refresh_token?: string; scope?: string; token_type?: string };
  verifyReadOnlyScope(token.scope);
  if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer' || !token.refresh_token) throw new Error('Google did not provide offline read-only access. Reconnect and grant access.');
  return { accessToken: token.access_token, refreshToken: token.refresh_token };
}
async function lookupSupportGmailProfile(accessToken: string, fetcher: typeof fetch = fetch) {
  assertOAuthAvailable();
  const response = await oauthFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher);
  if (!response.ok) throw new Error('Could not verify the connected Gmail mailbox.');
  const profile = await response.json() as { emailAddress?: string };
  return profile.emailAddress?.trim().toLowerCase() || '';
}
export async function supportGmailProfile(accessToken: string, fetcher: typeof fetch = fetch) {
  const email = await lookupSupportGmailProfile(accessToken, fetcher);
  assertExpectedMailbox(email);
  return email;
}
export function assertExpectedMailbox(email: string) {
  const expected = process.env.SUPPORT_GMAIL_MAILBOX?.trim().toLowerCase();
  if (!expected || !/^[^@\s]+@[^@\s]+$/.test(expected)) throw new Error('SUPPORT_GMAIL_MAILBOX must name the dedicated Support mailbox.');
  if (email.trim().toLowerCase() !== expected) throw new Error('Connected Gmail account does not match SUPPORT_GMAIL_MAILBOX.');
}
export async function connectionStatus(db?: ConnectionDb) {
  assertLiveSupportGmailEnvironment();
  const record = await (db ?? await connectionDb()).supportGmailConnection.findUnique({ where: { id: 'support' }, select: { mailbox: true, connectedAt: true, lastSyncedAt: true, grantedScope: true } });
  if (!record) return { connected: false, email: null, connectedAt: null, lastSyncedAt: null };
  assertExpectedMailbox(record.mailbox);
  verifyReadOnlyScope(record.grantedScope);
  return { connected: true, email: record.mailbox, connectedAt: record.connectedAt.toISOString(), lastSyncedAt: record.lastSyncedAt };
}
// Public identity/version only; rechecked even on in-memory cache hits.
export async function supportGmailReadIdentity(db?: ConnectionDb) {
  const status = await connectionStatus(db);
  if (!status.connected || !status.email || !status.connectedAt) throw new Error('Connect Support Gmail to read the Support inbox.');
  return { mailbox: status.email, version: status.connectedAt };
}
export async function connectedRefreshToken(db?: ConnectionDb): Promise<StoredConnection> {
  assertOAuthAvailable();
  const record = await (db ?? await connectionDb()).supportGmailConnection.findUnique({ where: { id: 'support' } });
  if (!record) throw new Error('Connect Support Gmail to read the Support inbox.');
  assertExpectedMailbox(record.mailbox);
  verifyReadOnlyScope(record.grantedScope);
  let refreshToken: string;
  try { refreshToken = decryptSupportGmailToken(record.refreshTokenEncrypted, record.mailbox); }
  catch { throw new Error('Stored Support Gmail credential is unavailable. Reconnect Gmail.'); }
  return { email: record.mailbox, refreshToken, scope: record.grantedScope, connectedAt: record.connectedAt.toISOString() };
}
export async function saveSupportGmailConnection(email: string, refreshToken: string, actor: Actor, db?: ConnectionDb) {
  assertOAuthAvailable();
  if (!can(actor, 'support-inbox.write')) throw new Error('Access denied');
  assertExpectedMailbox(email);
  const mailbox = email.trim().toLowerCase();
  const data = { mailbox, refreshTokenEncrypted: encryptSupportGmailToken(refreshToken, mailbox), grantedScope: SUPPORT_GMAIL_SCOPE, connectedAt: new Date(), connectedByUserId: actor.id, lastSyncedAt: null };
  await (db ?? await connectionDb()).supportGmailConnection.upsert({ where: { id: 'support' }, create: { id: 'support', ...data }, update: data });
}
export async function disconnectSupportGmail(actor: Actor, db?: ConnectionDb) {
  assertOAuthAvailable();
  if (!can(actor, 'support-inbox.write')) throw new Error('Access denied');
  await (db ?? await connectionDb()).supportGmailConnection.deleteMany({ where: { id: 'support' } });
}
export async function recordSupportGmailFetch(at: Date, db?: ConnectionDb) {
  assertLiveSupportGmailEnvironment();
  await (db ?? await connectionDb()).supportGmailConnection.updateMany({ where: { id: 'support', mailbox: process.env.SUPPORT_GMAIL_MAILBOX!.trim().toLowerCase() }, data: { lastSyncedAt: at } });
}

type OAuthInput = { actor: Actor | null; state: string | null; cookie?: string; verifier?: string; code: string | null; error: string | null };
export type SupportGmailConnectionResult = 'connected' | 'invalid-state' | 'declined' | 'failed';
type SupportGmailAuthorizationStage = 'environment/config validation' | 'OAuth state/PKCE validation' | 'token exchange' | 'Gmail profile lookup' | 'expected mailbox validation' | 'encrypted credential save';
function logSupportGmailAuthorizationFailure(stage: SupportGmailAuthorizationStage) {
  // Only fixed stage labels belong here. Errors, provider payloads and callback
  // input may contain OAuth secrets, cookies or complete request URLs.
  console.error(`[Support Gmail] OAuth callback failed at stage: ${stage}`);
}
export async function completeSupportGmailAuthorization(input: OAuthInput, dependencies = { exchange: exchangeSupportGmailCode, profile: lookupSupportGmailProfile, save: saveSupportGmailConnection }): Promise<SupportGmailConnectionResult> {
  let stage: SupportGmailAuthorizationStage = 'environment/config validation';
  let history: { db: Awaited<ReturnType<typeof connectionDb>>; id: number } | undefined;
  const { beginIntegrationAttempt, finishIntegrationAttempt, gmailContext, gmailFailure } = await import('./integration-attempts');
  try {
    assertOAuthAvailable();
    oauthSettings();
    encryptionKey();
    stateSecret();
    assertExpectedMailbox(process.env.SUPPORT_GMAIL_MAILBOX || '');
    stage = 'OAuth state/PKCE validation';
    if (!can(input.actor, 'support-inbox.write') || !consumeSupportGmailState(input.state, input.cookie, input.actor!.id, input.verifier)) {
      logSupportGmailAuthorizationFailure(stage);
      return 'invalid-state';
    }
    if (input.error) return 'declined';
    const db = await connectionDb();
    const attempt = await beginIntegrationAttempt(db, gmailContext('CONNECT', process.env.SUPPORT_GMAIL_MAILBOX!.trim().toLowerCase(), 'connection', input.actor!.id));
    history = { db, id: attempt.id };
    stage = 'token exchange';
    if (!input.code) {
      logSupportGmailAuthorizationFailure(stage);
      await finishIntegrationAttempt(db, attempt.id, 'AUTHENTICATION');
      return 'failed';
    }
    const token = await dependencies.exchange(input.code, input.verifier!);
    stage = 'Gmail profile lookup';
    const email = await dependencies.profile(token.accessToken);
    stage = 'expected mailbox validation';
    assertExpectedMailbox(email);
    stage = 'encrypted credential save';
    await dependencies.save(email, token.refreshToken, input.actor!);
    await finishIntegrationAttempt(db, attempt.id);
    return 'connected';
  } catch (error) {
    logSupportGmailAuthorizationFailure(stage);
    if (history) await finishIntegrationAttempt(history.db, history.id, gmailFailure(error));
    return 'failed';
  }
}
