import { e2eAuthEnabled } from './e2e-auth';

export const SUPPORT_GMAIL_INBOX_LIMIT = 50;
export const SUPPORT_GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export function supportGmailEnabled() { return process.env.SUPPORT_GMAIL_ENABLED === 'true'; }
export function assertSupportGmailEnabled() { if (!supportGmailEnabled()) throw new Error('Support Gmail is disabled.'); }
export function supportGmailMockMode() { return process.env.SUPPORT_GMAIL_MOCK === 'true' && e2eAuthEnabled(); }
export function supportGmailTestFixtureMode() { return !supportGmailMockMode() && process.env.SUPPORT_GMAIL_TEST_FIXTURE === 'true' && e2eAuthEnabled(); }
export function supportGmailMode() { return supportGmailMockMode() ? 'MOCK' : 'Gmail read-only'; }
export function supportGmailLookbackDays() {
  const value = process.env.SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS;
  const days = value === undefined || value === '' ? 30 : Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error('SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS must be between 1 and 365.');
  return days;
}
export function supportGmailOrigin() {
  let url: URL;
  try { url = new URL(process.env.AUTH_URL || ''); } catch { throw new Error('AUTH_URL must be the canonical SalesHub origin.'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.protocol !== 'https:') throw new Error('Support Gmail requires a canonical HTTPS AUTH_URL origin.');
  return url.origin;
}
export function supportGmailCallback() {
  const expected = new URL('/api/support-gmail/callback', supportGmailOrigin()).toString();
  const configured = process.env.SUPPORT_GMAIL_OAUTH_CALLBACK_URL || expected;
  if (configured !== expected) throw new Error('Support Gmail callback must match AUTH_URL and /api/support-gmail/callback exactly.');
  return configured;
}
export function supportGmailDatabaseIdentity() {
  let db: URL;
  try { db = new URL(process.env.DATABASE_URL || ''); } catch { throw new Error('Support Gmail requires a valid PostgreSQL database.'); }
  if (!['postgresql:', 'postgres:'].includes(db.protocol) || !db.username || !db.pathname.slice(1)) throw new Error('Support Gmail requires a valid PostgreSQL database.');
  return `${db.username}@${db.hostname}:${db.port || '5432'}${db.pathname}`;
}
// Live credentials are deliberately unavailable to local development. Fixture
// access is separately bounded to the existing disposable E2E authentication DB.
export function assertLiveSupportGmailEnvironment() {
  assertSupportGmailEnabled();
  if (process.env.NODE_ENV !== 'production' || process.env.SUPPORT_GMAIL_MOCK === 'true' || process.env.SUPPORT_GMAIL_TEST_FIXTURE === 'true' || process.env.E2E_AUTH_ENABLED === 'true') throw new Error('Live Support Gmail requires production with test modes disabled.');
  const origin = new URL(supportGmailOrigin());
  if (['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(origin.hostname)) throw new Error('Live Support Gmail requires the production SalesHub hostname.');
  supportGmailCallback();
  const identity = supportGmailDatabaseIdentity();
  const db = new URL(process.env.DATABASE_URL!);
  if (identity !== process.env.SUPPORT_GMAIL_EXPECTED_DATABASE_IDENTITY || ['localhost', '127.0.0.1', '[::1]', 'db'].includes(db.hostname) || /(?:support_poc|saleshub_e2e)/i.test(db.pathname) || !['require', 'verify-ca', 'verify-full'].includes(db.searchParams.get('sslmode') || '')) throw new Error('Support Gmail database must match its configured production identity and require TLS.');
}
export function supportGmailEnvironmentIssue() {
  if (process.env.NODE_ENV !== 'production') return 'Live Support Gmail is unavailable on this development instance. Use the production SalesHub site to connect the Support mailbox.';
  try { assertLiveSupportGmailEnvironment(); return null; }
  catch { return 'Support Gmail is not configured for this environment. Ask an administrator to check the production Gmail runtime settings.'; }
}
export function assertLiveSupportGmailRequest(host: string | null) {
  assertLiveSupportGmailEnvironment();
  if (host?.toLowerCase() !== new URL(supportGmailOrigin()).host.toLowerCase()) throw new Error('Open Support Gmail from the canonical SalesHub production URL.');
}
