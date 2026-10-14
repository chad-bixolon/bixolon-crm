import crypto from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
export const fixtureEnv = { NODE_ENV: 'test', E2E_AUTH_ENABLED: 'true', E2E_AUTH_TOKEN: 'synthetic-unit-auth', DATABASE_URL: 'postgresql://saleshub_e2e:unit@127.0.0.1:55432/saleshub_e2e', SUPPORT_GMAIL_ENABLED: 'true', SUPPORT_GMAIL_MOCK: 'true', SUPPORT_GMAIL_TEST_FIXTURE: 'false', SUPPORT_GMAIL_MAILBOX: 'support@bixolonusa.com' };
export function productionEnv(mailbox = 'support@example.test') {
  return { NODE_ENV: 'production', E2E_AUTH_ENABLED: 'false', SUPPORT_GMAIL_ENABLED: 'true', SUPPORT_GMAIL_MOCK: 'false', SUPPORT_GMAIL_TEST_FIXTURE: 'false', AUTH_URL: 'https://saleshub.example.test', AUTH_SECRET: 'synthetic-state-secret', DATABASE_URL: 'postgresql://saleshub:unit@postgres.example.test:25060/saleshub?sslmode=require', SUPPORT_GMAIL_EXPECTED_DATABASE_IDENTITY: 'saleshub@postgres.example.test:25060/saleshub', SUPPORT_GMAIL_MAILBOX: mailbox, SUPPORT_GMAIL_CLIENT_ID: 'dedicated-client', SUPPORT_GMAIL_CLIENT_SECRET: 'dedicated-secret', SUPPORT_GMAIL_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), SUPPORT_GMAIL_OAUTH_CALLBACK_URL: 'https://saleshub.example.test/api/support-gmail/callback', SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS: '30' };
}
export function installConnectionDb() {
  let record = null;
  const db = { supportGmailConnection: {
    async findUnique({select} = {}) { return record && (select ? Object.fromEntries(Object.keys(select).map(key => [key, record[key]])) : {...record}); },
    async upsert({create, update}) { record = { ...(record ? {...record, ...update} : create), updatedAt: new Date() }; return {...record}; },
    async deleteMany() { record = null; return {count: 1}; },
    async updateMany({data}) { if (record) Object.assign(record, data); return {count: record ? 1 : 0}; },
  }};
  const filename = require.resolve(path.join(root, 'lib/prisma.ts'));
  require.cache[filename] = {id: filename, filename, loaded: true, exports: {prisma: db}};
  return {db, get record() {return record;}, reset() {record = null;}};
}
