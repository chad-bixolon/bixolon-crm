import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { getBranding, brandedTitle, defaultBranding } = require(path.join(root, 'lib/deployment-branding.ts'));
const { normalizeTrustedDomain, getTrustedDomains, mutateTrustedDomain, trustedGoogleDomain } = require(path.join(root, 'lib/trusted-domains.ts'));
const { saveBrandingNames, setBrandingLogo } = require(path.join(root, 'lib/branding-admin.ts'));
const { can } = require(path.join(root, 'lib/authorization.ts'));
const actor = role => ({ id: 1, role, active: true, archivedAt: null });

function fixture() {
  const state = { domains: new Map(), branding: null, events: [], user: actor('ADMIN'), locks: 0 };
  const db = {
    $queryRaw: async () => { state.locks++; return []; },
    $transaction: async callback => callback(db),
    user: { findUnique: async () => state.user },
    trustedSignInDomain: {
      findMany: async () => [...state.domains.values()],
      findUnique: async ({ where }) => state.domains.get(where.domain) ?? null,
      count: async ({ where } = {}) => [...state.domains.values()].filter(row => where?.active === undefined || row.active === where.active).length,
      create: async ({ data }) => { state.domains.set(data.domain, { ...data, createdAt: new Date(), updatedAt: new Date() }); },
      update: async ({ where, data }) => { state.domains.set(where.domain, { ...state.domains.get(where.domain), ...data }); },
    },
    deploymentBranding: {
      findUnique: async () => state.branding,
      upsert: async ({ create, update }) => { state.branding = state.branding ? { ...state.branding, ...update } : create; },
    },
    adminMaintenanceEvent: { create: async ({ data }) => { state.events.push(data); } },
  };
  return { db, state };
}

test('current BIXOLON branding and bootstrap domain work with no rows', async () => {
  const { db } = fixture();
  assert.deepEqual(await getBranding(db), defaultBranding);
  assert.equal(brandedTitle(await getBranding(db)), 'BIXOLON SalesHub');
  assert.deepEqual((await getTrustedDomains(db, 'BIXOLONUSA.COM')).map(row => row.domain), ['bixolonusa.com']);
});

test('domain validation normalizes case and rejects protocols, paths, wildcard, spaces', () => {
  assert.equal(normalizeTrustedDomain('  BiXoLoN.CoM  '), 'bixolon.com');
  for (const value of ['https://bixolon.com', 'bixolon.com/path', '*.bixolon.com', 'bixolon .com', 'bixolon.com:443', 'a..com', '-bixolon.com', '192.168.1.1']) assert.throws(() => normalizeTrustedDomain(value));
});

test('removing a domain revokes linked-session eligibility regardless of User role', () => {
  assert.equal(trustedGoogleDomain('bixolon.com', 'leader@bixolon.com', ['bixolonusa.com', 'bixolon.com']), true);
  assert.equal(trustedGoogleDomain('bixolon.com', 'leader@bixolon.com', ['bixolonusa.com']), false);
  assert.equal(trustedGoogleDomain('bixolon.com', 'leader@outside.com', ['bixolon.com']), false);
});

test('Admin domain changes materialize bootstrap, then persisted rows control policy', async () => {
  const { db, state } = fixture();
  await mutateTrustedDomain(db, actor('ADMIN'), { action: 'add', domain: 'BIXOLON.COM' }, 'bixolonusa.com');
  assert.deepEqual([...state.domains.keys()].sort(), ['bixolon.com', 'bixolonusa.com']);
  assert.deepEqual((await getTrustedDomains(db, 'other.com')).map(row => row.domain).sort(), ['bixolon.com', 'bixolonusa.com']);
  await mutateTrustedDomain(db, actor('ADMIN'), { action: 'deactivate', domain: 'bixolon.com' }, 'bixolonusa.com');
  assert.equal(state.domains.get('bixolon.com').active, false);
  await mutateTrustedDomain(db, actor('ADMIN'), { action: 'activate', domain: 'BIXOLON.COM' }, 'bixolonusa.com');
  assert.equal(state.domains.get('bixolon.com').active, true);
  assert.deepEqual(state.events.map(event => event.action), ['Added', 'Deactivated', 'Activated']);
  assert.equal(state.events.every(event => event.actorId === 1 && event.newValue.includes('bixolon.com')), true);
  assert.ok(state.locks >= 3);
});

test('last domain and own sign-in domain are protected', async () => {
  const { db } = fixture();
  await assert.rejects(mutateTrustedDomain(db, actor('ADMIN'), { action: 'deactivate', domain: 'bixolonusa.com' }, 'bixolonusa.com'), /at least one active/);
  await mutateTrustedDomain(db, actor('ADMIN'), { action: 'add', domain: 'bixolon.com' }, 'bixolonusa.com');
  await assert.rejects(mutateTrustedDomain(db, actor('ADMIN'), { action: 'deactivate', domain: 'bixolonusa.com', currentIdentityDomain: 'bixolonusa.com' }, 'bixolonusa.com'), /current sign-in domain/);
  await mutateTrustedDomain(db, actor('ADMIN'), { action: 'deactivate', domain: 'bixolonusa.com', currentIdentityDomain: 'bixolonusa.com', confirmOwnDomain: true }, 'bixolonusa.com');
});

test('only a current Admin can mutate deployment branding or domains', async () => {
  const { db, state } = fixture();
  for (const role of ['SALES_MANAGER', 'EXECUTIVE', 'SUPPORT_MANAGER', 'MARKETING_MANAGER', 'READ_ONLY']) {
    assert.equal(can({ ...actor(role), delegatedUserAdministrationEnabled: true }, 'deployment.manage'), false);
    await assert.rejects(saveBrandingNames(db, { ...actor(role), delegatedUserAdministrationEnabled: true }, 'Acme', 'Acme CRM'), /Access denied/);
    await assert.rejects(mutateTrustedDomain(db, actor(role), { action: 'add', domain: 'bixolon.com' }, 'bixolonusa.com'), /Access denied/);
  }
  state.user = actor('SALES_MANAGER');
  await assert.rejects(saveBrandingNames(db, actor('ADMIN'), 'Acme', 'Acme CRM'), /Access denied/);
  await assert.rejects(mutateTrustedDomain(db, actor('ADMIN'), { action: 'add', domain: 'bixolon.com' }, 'bixolonusa.com'), /Access denied/);
});

test('branding names are audited with safe old/new values', async () => {
  const { db, state } = fixture();
  await saveBrandingNames(db, actor('ADMIN'), 'Acme Distribution', 'Acme CRM');
  assert.equal(state.branding.companyName, 'Acme Distribution');
  assert.equal(state.branding.productName, 'Acme CRM');
  assert.equal(brandedTitle(state.branding), 'Acme Distribution Acme CRM');
  assert.deepEqual(state.events.map(event => [event.action, event.oldValue, event.newValue]), [
    ['Company Name changed', 'BIXOLON America, Inc.', 'Acme Distribution'],
    ['Product Name changed', 'SalesHub', 'Acme CRM'],
  ]);
});

test('logo replacement and reset retire old objects and audit metadata only', async () => {
  const { db, state } = fixture();
  const uploaded = [], deleted = [];
  let id = 0;
  const storage = { createBrandingKey: () => `test/branding/${++id}`, uploadDocumentObject: async object => uploaded.push(object), deleteDocumentObject: async key => deleted.push(key) };
  await setBrandingLogo(db, storage, actor('ADMIN'), { body: Uint8Array.of(1, 2, 3), mimeType: 'image/png' });
  await setBrandingLogo(db, storage, actor('ADMIN'), { body: Uint8Array.of(4, 5), mimeType: 'image/webp' });
  await setBrandingLogo(db, storage, actor('ADMIN'), null);
  assert.equal(state.branding.logoStorageKey, null);
  assert.deepEqual(deleted, ['test/branding/1', 'test/branding/2']);
  assert.deepEqual(state.events.map(event => event.action), ['Logo changed', 'Logo changed', 'Logo reset']);
  assert.equal(state.events.every(event => !JSON.stringify(event).includes('body')), true);
  assert.equal(uploaded.length, 2);
});
