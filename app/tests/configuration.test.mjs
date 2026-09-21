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
const config = require(path.join(root, 'lib/configuration.ts'));
const lookups = require(path.join(root, 'lib/lookups.ts'));
const stages = require(path.join(root, 'lib/sales-stage-admin.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const { saveActivity } = require(path.join(root, 'lib/work.ts'));
const form = (entries) => { const result = new FormData(); for (const [key, value] of entries) result.append(key, value); return result; };

test('required internal keys are fixed; override labels are trimmed and fall back', async () => {
  assert.equal(config.defaultLabels.STRATEGIC_ACCOUNT, 'Strategic Account');
  assert.equal(config.resolveLabel('VAR'), 'VAR / Reseller');
  assert.equal(config.labelMap([{ key: 'VAR', displayLabel: ' Channel reseller ' }, { key: 'UNKNOWN', displayLabel: 'Ignored' }]).VAR, 'Channel reseller');
  assert.equal(config.labelMap([]).PARTNER, 'Service Partner');
  assert.throws(() => config.parseLabel('   '), /1–80/);
  assert.throws(() => config.parseLabel('x'.repeat(81)), /1–80/);
  const writes = [];
  const client = { terminologyLabel: { upsert: async value => writes.push(value) } };
  await assert.rejects(config.saveLabel(client, 'UNRECOGNIZED', 'Foo', 7), /Unknown/);
  await config.saveLabel(client, 'ACCOUNT', '  Customer  ', 7);
  assert.deepEqual(writes[0].create, { key: 'ACCOUNT', displayLabel: 'Customer', changedById: 7 });
  assert.deepEqual(Object.keys(writes[0].update).sort(), ['changedAt', 'changedById', 'displayLabel']);
  await config.restoreLabel(client, 'ACCOUNT', 7);
  assert.equal(writes[1].create.displayLabel, 'Account');
  await assert.rejects(config.restoreLabel(client, 'UNRECOGNIZED', 7), /Unknown/);
});

test('activity type management keeps code stable and can deactivate without deletion', async () => {
  const input = lookups.parseLookup(form([['code', 'DEMO'], ['name', ' Product demo '], ['sortOrder', '3']]), true).value;
  assert.equal(input.active, false);
  const calls = [];
  const client = { activityType: { update: async args => calls.push(args), create: async args => calls.push(args) } };
  await lookups.saveLookup(client, 'activity-types', input, true);
  assert.deepEqual(calls[0], { where: { code: 'DEMO' }, data: { name: 'Product demo', active: false, sortOrder: 3 } });
  await lookups.saveLookup(client, 'activity-types', { ...input, code: 'CALL', active: true }, false);
  assert.equal(calls[1].data.code, 'CALL');
  assert.equal(lookups.lookupKind('activity-types'), true);
});
test('Product Category lookup can be created, deactivated, and reactivated without deletion', async () => {
  assert.equal(lookups.lookupKind('product-categories'), true);
  assert.equal(lookups.lookupTitle('product-categories'), 'Product Category');
  const calls = [];
  const client = { productCategory: { create: async args => calls.push(['create',args]), update: async args => calls.push(['update',args]) } };
  const input = { code: 'POS', name: 'POS', active: true, sortOrder: 0 };
  await lookups.saveLookup(client, 'product-categories', input, false);
  await lookups.saveLookup(client, 'product-categories', { ...input, active: false }, true);
  await lookups.saveLookup(client, 'product-categories', input, true);
  assert.deepEqual(calls.map(([operation]) => operation), ['create','update','update']);
  assert.deepEqual(calls[1][1], { where: { code: 'POS' }, data: { name: 'POS', active: false, sortOrder: 0 } });
  assert.equal(calls[2][1].data.active, true);
});

test('inactive activity type remains valid only when unchanged on an existing activity', async () => {
  const value = { subject: 'Demo', description: null, accountId: 1, opportunityId: null, projectId: null, userId: null, type: 'DEMO', activityDate: new Date() };
  const tx = { account: { findFirst: async () => ({ id: 1 }) }, activity: { findFirst: async () => ({ id: 2, type: 'DEMO' }), update: async ({ data }) => data }, activityType: { findFirst: async () => null } };
  assert.equal((await saveActivity({ $transaction: fn => fn(tx) }, value, 2)).type, 'DEMO');
  await assert.rejects(saveActivity({ $transaction: fn => fn(tx) }, { ...value, type: 'OTHER' }, 2), /active activity type/);
});

test('sales stages validate bounds and closed/won invariants, retaining immutable IDs', async () => {
  const valid = stages.parseStage(form([['name', ' Closed won '], ['probability', '100'], ['sortOrder', '5'], ['isClosed', 'on'], ['isWon', 'on']]));
  assert.equal(valid.name, 'Closed won');
  assert.throws(() => stages.parseStage(form([['name', 'Won'], ['probability', '100'], ['sortOrder', '0'], ['isWon', 'on']])), /must also be closed/);
  assert.throws(() => stages.parseStage(form([['name', 'Too high'], ['probability', '101'], ['sortOrder', '0']])), /0–100/);
  const calls = [];
  const tx = { salesStage: { findUnique: async () => ({ isClosed: false, isWon: false }), update: async args => calls.push(args), create: async args => calls.push(args) }, opportunity: { updateMany: async args => calls.push(args) } };
  const client = { ...tx, $transaction: async fn => fn(tx) };
  await stages.saveStage(client, 3, valid);
  assert.deepEqual(calls[0].where, { id: 3 });
  assert.equal(calls[0].data.id, undefined);
  assert.deepEqual(calls[1], { where: { stageId: 3 }, data: { forecastCategory: 'CLOSED' } });
  calls.length = 0;
  tx.salesStage.findUnique = async () => ({ isClosed: true, isWon: true });
  await stages.saveStage(client, 3, { ...valid, isClosed: false, isWon: false });
  assert.deepEqual(calls[1], { where: { stageId: 3 }, data: { forecastCategory: 'PIPELINE' } });
});

test('settings reject unknown keys and unsafe ranges', () => {
  assert.equal(config.parseSetting('STALE_ACCOUNT_WARNING_DAYS', '90'), 90);
  assert.throws(() => config.parseSetting('STALE_ACCOUNT_WARNING_DAYS', '0'), /1–3650/);
  assert.throws(() => config.parseSetting('UNSAFE', '1'), /Unknown/);
});

test('non-admin and inactive users cannot enter any administration section', () => {
  for (const pathname of ['/administration', '/administration/labels', '/administration/settings', '/administration/sales-stages', '/administration/lookups/activity-types', '/administration/lookups/product-categories']) {
    assert.equal(routeAccess(pathname, { id: 1, role: 'SALES', active: true }), 'denied');
    assert.equal(routeAccess(pathname, { id: 1, role: 'ADMIN', active: false }), 'denied');
    assert.equal(routeAccess(pathname, { id: 1, role: 'ADMIN', active: true }), 'allowed');
  }
});
