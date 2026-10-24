import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { normalizeInternalDomain, getInternalDomainRows, activeInternalDomainSet, isInternalEmail, mutateInternalDomain } = require(path.join(root, 'lib/internal-email-domains.ts'));
const { trustedGoogleDomain } = require(path.join(root, 'lib/trusted-domains.ts'));
const { matchCalendarAttendees } = require(path.join(root, 'lib/calendar-matching.ts'));
const { originalSupportRequest } = require(path.join(root, 'lib/support-email-source.ts'));

function fixture(trusted = ['bixolonusa.com', 'bixolon.com']) {
  const domains = new Map(), events = [];
  let actor = { id: 1, role: 'ADMIN', active: true, archivedAt: null };
  const db = {
    internalEmailDomain: {
      findMany: async () => [...domains.values()].sort((a, b) => a.domain.localeCompare(b.domain)),
      create: async ({ data }) => { const row = { ...data, updatedById: data.updatedById ?? null, createdAt: new Date(), updatedAt: new Date() }; domains.set(data.domain, row); return row; },
      update: async ({ where, data }) => { const row = { ...domains.get(where.domain), ...data }; domains.set(where.domain, row); return row; },
    },
    trustedSignInDomain: { findMany: async () => trusted.map(domain => ({ domain })) },
    user: { findUnique: async () => actor },
    adminMaintenanceEvent: { create: async ({ data }) => { events.push(data); } },
    $queryRaw: async () => [{ locked: 1 }],
    $transaction: async callback => callback(db),
  };
  return { db, domains, events, setActor: value => { actor = value; } };
}

test('normalization rejects addresses, URL forms, wildcards, malformed labels, and IPs', () => {
  assert.equal(normalizeInternalDomain(' Acme.COM '), 'acme.com');
  for (const value of ['person@acme.com', 'https://acme.com', 'acme.com/path', '*.acme.com', 'bad..com', '-acme.com', 'acme.com:443', '192.168.1.1']) assert.throws(() => normalizeInternalDomain(value));
});

test('bootstrap is visible, deduplicated, and materialized on the first Admin mutation', async () => {
  const { db, domains, events } = fixture(['bixolonusa.com', 'bixolon.com', 'BIXOLON.COM']);
  assert.deepEqual((await getInternalDomainRows(db, 'BIXOLONUSA.COM')).rows.map(row => row.domain), ['bixolon.com', 'bixolonusa.com']);
  await mutateInternalDomain(db, { id: 1, role: 'ADMIN', active: true }, { action: 'add', domain: 'Acme.COM' }, 'bixolonusa.com');
  assert.deepEqual([...domains.keys()].sort(), ['acme.com', 'bixolon.com', 'bixolonusa.com']);
  assert.equal(domains.get('acme.com').updatedById, 1);
  assert.deepEqual(events.map(row => [row.action, row.oldValue, row.newValue]), [['Added', null, 'acme.com: Active']]);
  assert.equal((await getInternalDomainRows(db, 'other.com')).persisted, true);
  assert.equal((await activeInternalDomainSet(db, 'other.com')).has('other.com'), false);
});

test('inactive and zero-active persisted lists remain authoritative and do not affect trusted sign-in', async () => {
  const { db, events } = fixture(['acme.com', 'parentcompany.com']);
  const admin = { id: 1, role: 'ADMIN', active: true };
  await mutateInternalDomain(db, admin, { action: 'deactivate', domain: 'parentcompany.com' }, 'acme.com');
  await mutateInternalDomain(db, admin, { action: 'deactivate', domain: 'acme.com' }, 'acme.com');
  const empty = await activeInternalDomainSet(db, 'acme.com');
  assert.equal(empty.size, 0);
  assert.equal(isInternalEmail('지민@acme.com', empty), false);
  assert.equal(trustedGoogleDomain('parentcompany.com', '지민@parentcompany.com', ['acme.com', 'parentcompany.com']), true);
  await mutateInternalDomain(db, admin, { action: 'activate', domain: 'acme.com' }, 'acme.com');
  const active = await activeInternalDomainSet(db, 'other.com');
  assert.equal(isInternalEmail('지민@ACME.COM', active), true);
  assert.equal(isInternalEmail('user@eu.acme.com', active), false);
  assert.equal(isInternalEmail('user@parentcompany.com', active), false);
  assert.equal(trustedGoogleDomain('acme.com', 'user@acme.com', ['parentcompany.com']), false);
  assert.deepEqual(events.map(row => row.action), ['Deactivated', 'Deactivated', 'Activated']);
});

test('only a current true Admin can mutate internal domains', async () => {
  const { db, setActor } = fixture();
  for (const role of ['SALES_MANAGER', 'EXECUTIVE', 'SUPPORT_MANAGER', 'MARKETING_MANAGER', 'READ_ONLY']) {
    await assert.rejects(mutateInternalDomain(db, { id: 1, role, active: true, delegatedUserAdministrationEnabled: true }, { action: 'add', domain: 'acme.com' }), /Access denied/);
  }
  setActor({ id: 1, role: 'SALES_MANAGER', active: true, delegatedUserAdministrationEnabled: true });
  await assert.rejects(mutateInternalDomain(db, { id: 1, role: 'ADMIN', active: true }, { action: 'add', domain: 'acme.com' }), /Access denied/);
});

test('Calendar and Support classify BIXOLON dual domains and generic Acme policy exactly', () => {
  const attendee = email => ({ email, self: false, displayName: '지민' });
  const bixolon = new Set(['bixolonusa.com', 'bixolon.com']);
  const result = matchCalendarAttendees([attendee('지민@BIXOLON.COM'), attendee('rep@bixolonusa.com')], [], bixolon, 'owner@bixolonusa.com', 'manager@bixolon.com');
  assert.equal(result.internalOnly, true);
  assert.equal(result.external.length, 0);
  assert.equal(isInternalEmail('customer@example.com', bixolon), false);
  const thread = [{ senderEmail: 'REP@BIXOLON.COM' }, { senderEmail: 'customer@example.com' }];
  assert.equal(originalSupportRequest(thread, bixolon), thread[1]);
  const acme = new Set(['acme.com']);
  assert.equal(matchCalendarAttendees([attendee('rep@acme.com'), attendee('parent@parentcompany.com')], [], acme, 'owner@acme.com').external.length, 1);
  assert.equal(originalSupportRequest([{ senderEmail: 'rep@acme.com' }, { senderEmail: 'parent@parentcompany.com' }], acme).senderEmail, 'parent@parentcompany.com');
});
