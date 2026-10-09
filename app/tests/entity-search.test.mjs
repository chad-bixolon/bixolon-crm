import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const file = path.join(root, 'lib/entity-search.ts');
const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function load() {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    if (name === '@prisma/client') return { AccountBusinessRoleCode: { DISTRIBUTOR: 'DISTRIBUTOR', VAR: 'VAR', ISV: 'ISV', OEM: 'OEM', PARTNER: 'PARTNER' } };
    if (name === './authorization') return { assertPermission(actor, permission) { if (!actor.allowed?.includes(permission)) throw new Error('Access denied'); }, opportunityScope: actor => actor.role === 'SALES' ? { ownerId: actor.id } : {} };
    if (name === './operational-where') return { operationalAccountWhere: { status: 'ACTIVE' }, operationalContactWhere: { active: true }, operationalOpportunityWhere: { archivedAt: null }, operationalProjectWhere: { archivedAt: null } };
    if (name === './projects') return { projectReadWhere: actor => ({ ownerId: actor.role === 'SALES' ? actor.id : undefined }) };
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const { searchEntities } = load();
const actor = { id: 7, role: 'SALES', allowed: ['accounts.read', 'contacts.read', 'opportunities.read', 'projects.read'] };

function database(rowsByType) {
  const calls = [];
  const db = Object.fromEntries(['account', 'contact', 'opportunity', 'project'].map(type => [type, { async findMany(args) { calls.push({ type, args }); return rowsByType[type] ?? []; } }]));
  return { db, calls };
}

test('two-character minimum skips the database and unauthorized type is rejected', async () => {
  const { db, calls } = database({});
  assert.deepEqual(await searchEntities(db, actor, 'account', 'a'), []);
  assert.equal(calls.length, 0);
  await assert.rejects(searchEntities(db, { ...actor, allowed: [] }, 'contact', 'ada'), /Access denied/);
  assert.equal(calls.length, 0);
});

test('Account results rank exact, prefix, word prefix, then contains with a stable alphabetical tie', async () => {
  const { db, calls } = database({ account: [
    { id: 5, name: 'South Acme', city: null, stateProvince: null },
    { id: 4, name: 'Acme Zebra', city: 'Boston', stateProvince: 'MA' },
    { id: 3, name: 'Acme Alpha', city: null, stateProvince: null },
    { id: 2, name: 'Acme', city: 'Philadelphia', stateProvince: 'PA' },
    { id: 8, name: 'MegaAcme', city: null, stateProvince: null },
  ] });
  const result = await searchEntities(db, actor, 'account', 'Acme');
  assert.deepEqual(result.map(row => row.name), ['Acme', 'Acme Alpha', 'Acme Zebra', 'South Acme', 'MegaAcme']);
  assert.equal(result[0].context, 'Philadelphia, PA');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.args.take === 25 && call.args.orderBy.at(-1).id === 'asc'));
});

test('all entity searches use bounded database queries with relation context and caller filters', async () => {
  const { db, calls } = database({
    contact: [{ id: 1, firstName: 'Jane', lastName: 'Smith', email: 'jane@example.test', accountId: 12, account: { name: 'Acme' } }],
    opportunity: [{ id: 2, name: 'Pilot', participants: [{ accountId: 12, account: { name: 'Acme' } }], projects: [] }],
    project: [{ id: 3, name: 'Launch', primaryAccountId: 12, primaryAccount: { name: 'Acme' }, participants: [], opportunities: [] }],
  });
  const contact = await searchEntities(db, actor, 'contact', 'jane', { accountId: 12 });
  const opportunity = await searchEntities(db, actor, 'opportunity', 'pilot', { accountId: 12, openOnly: true });
  const project = await searchEntities(db, actor, 'project', 'launch', { accountId: 12, projectStatus: 'ACTIVE' });
  assert.match(contact[0].context, /Acme.*jane@example.test/);
  assert.equal(opportunity[0].context, 'Acme');
  assert.equal(project[0].context, 'Acme');
  assert.equal(calls.length, 15);
  assert.ok(calls.every(call => call.args.take <= 25));
  const where = JSON.stringify(calls.map(call => call.args.where));
  assert.match(where, /accountId/);
  assert.match(where, /isClosed/);
  assert.match(where, /ownerId/);
  assert.match(where, /ACTIVE/);
});

test('direct Opportunity names remain discoverable when Account context fills each general batch', async () => {
  const contextRows = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, name: `Other ${index}`, participants: [{ accountId: 9, account: { name: 'Acme' } }], projects: [] }));
  const exact = { id: 99, name: 'Acme', participants: [], projects: [] };
  const calls = [];
  const db = { opportunity: { async findMany(args) {
    calls.push(args);
    return args.where.AND[1].name ? [exact] : contextRows;
  } } };
  const results = await searchEntities(db, actor, 'opportunity', 'Acme');
  assert.equal(results[0].id, exact.id);
  assert.equal(results.length, 25);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.take === 25));
});
