import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = Module.createRequire(import.meta.url);
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const { currencyConfiguration, showCurrencyControl, canRetainCurrency, getCurrencyConfiguration, configureCurrency, supportedCurrencies } = require('../lib/currency-configuration.ts');
const { normalizeSavedQuery, savedQueryHref } = require('../lib/saved-views.ts');
const { opportunityWhere } = require('../lib/opportunities.ts');
const { resolveUserContext } = require('../lib/dev-impersonation.ts');
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === '@/lib/currency-rules') return require('../lib/currency-rules.ts');
  return originalLoad.call(this, name, parent, main);
};
const { CurrencyProvider, CurrencyControl } = require('../components/currency-control.tsx');
Module._load = originalLoad;
const usd = { code: 'USD', name: 'US Dollar', active: true, isDefault: true };
const cad = { code: 'CAD', name: 'Canadian Dollar', active: true, isDefault: false };
const admin = { id: 1, role: 'ADMIN', active: true, archivedAt: null };
function fixture(initial = [usd]) {
  const rows = structuredClone(initial);
  const tx = { $queryRaw: async () => [], currency: {
    findMany: async () => structuredClone(rows), findUnique: async ({where}) => rows.find(row => row.code === where.code) ?? null,
    count: async () => rows.filter(row => row.active).length,
    create: async ({data}) => rows.push({isDefault:false, ...data}),
    update: async ({where,data}) => Object.assign(rows.find(row => row.code === where.code), data),
    updateMany: async ({data}) => rows.filter(row => row.isDefault).forEach(row => Object.assign(row, data)),
  }};
  return { rows, ...tx, $transaction: async callback => callback(tx) };
}
test('one active currency hides the actual selector and preserves submitted and URL state', () => {
  const config = currencyConfiguration([usd]);
  const html = renderToStaticMarkup(React.createElement(CurrencyProvider, {configuration:config}, React.createElement(CurrencyControl, {value:'USD'}, React.createElement('label', null, 'Currency', React.createElement('select', {name:'currencyCode'}, React.createElement('option', null, 'USD'))))));
  assert.doesNotMatch(html, /<select|<label/);
  assert.match(html, /type="hidden" name="currencyCode" value="USD"/);
  for (const route of ['opportunities', 'pipeline']) {
    assert.deepEqual(normalizeSavedQuery(route, {currencyCode:'USD'}), {currencyCode:'USD'});
    assert.match(savedQueryHref(route, {currencyCode:'USD'}), /currencyCode=USD/);
  }
  assert.equal(opportunityWhere({currencyCode:'USD'}).currencyCode, 'USD');
});
test('two active currencies show controls, independently of their codes', () => {
  const config = currencyConfiguration([usd, cad]);
  assert.equal(showCurrencyControl(config), true);
  assert.equal(currencyConfiguration([{...cad,isDefault:true}]).multiCurrencyEnabled, false);
  const html = renderToStaticMarkup(React.createElement(CurrencyProvider, {configuration:config}, React.createElement(CurrencyControl, {value:'CAD'}, React.createElement('select', {name:'currencyCode'}, React.createElement('option', null, 'CAD')))));
  assert.match(html, /<select/);
});
test('inactive currencies remain readable and retainable, but cannot enter new records', () => {
  const inactive = {...cad,active:false};
  assert.equal(showCurrencyControl(currencyConfiguration([usd,inactive]), ['USD','CAD']), true);
  assert.equal(canRetainCurrency(inactive,'CAD'), false);
  assert.equal(canRetainCurrency(inactive,'CAD','CAD'), true);
  assert.equal(canRetainCurrency(null,'CAD','CAD'), false);
  assert.equal(opportunityWhere({currencyCode:'CAD'}).currencyCode,'CAD');
});
test('adding, default changes, activation and deactivation preserve definitions', async () => {
  const db = fixture();
  await assert.rejects(configureCurrency(db, admin, 'deactivate','USD'), /default/);
  await configureCurrency(db, admin, 'add','CAD');
  await configureCurrency(db, admin, 'default','CAD');
  assert.equal((await getCurrencyConfiguration(db)).defaultCurrency, 'CAD');
  await configureCurrency(db, admin, 'deactivate','USD');
  assert.equal(db.rows.length,2);
  assert.equal(db.rows.find(row=>row.code==='USD').active,false);
  await assert.rejects(configureCurrency(db, admin, 'default','USD'), /Activate/);
  await assert.rejects(configureCurrency(db, admin, 'deactivate','CAD'), /default/);
  await configureCurrency(db, admin, 'activate','USD');
  assert.equal((await getCurrencyConfiguration(db)).multiCurrencyEnabled,true);
  assert.ok(supportedCurrencies().some(row=>row.code==='JPY'));
  await assert.rejects(configureCurrency(db,admin,'add','ZZZ'), /supported/);
});
test('configuration uses the effective role during impersonation', async () => {
  const target = {id:2,firstName:'Sales',lastName:'User',email:'sales@test.local',role:'SALES',active:true,archivedAt:null};
  const context = await resolveUserContext({...admin,name:'Admin',email:'admin@test.local'}, '2', {user:{findUnique:async()=>target}}, {NODE_ENV:'development',ENABLE_DEV_IMPERSONATION:'true'});
  assert.equal(context.impersonating,true);
  await assert.rejects(configureCurrency(fixture(),context.effective,'add','CAD'), /Access denied/);
  for (const role of ['SALES','SALES_MANAGER','READ_ONLY','SUPPORT','MARKETING_MANAGER']) await assert.rejects(configureCurrency(fixture(),{...admin,role},'add','CAD'), /Access denied/);
});
