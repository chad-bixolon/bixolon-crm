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
const { modules, resolveModules, moduleForPath, requiredModulesForPath, reportTypeAvailable, builtInReportAvailable, dashboardWidgetAvailable, moduleForSavedView, moduleForNotificationCategory, qualityIssueAvailable, moduleForAuditEntity } = require(path.join(root, 'lib/module-policy.ts'));

test('BIXOLON defaults and absent rows enable every current optional module', () => {
  const result = resolveModules([]);
  assert.equal(modules.length, 11);
  assert.deepEqual([...result.configured].sort(), [...modules].sort());
  assert.deepEqual([...result.effective].sort(), [...modules].sort());
  assert.equal(resolveModules([{ module: 'DEMOS', enabled: false }]).effective.has('DEMOS'), false);
});

test('dependent choices remain configured through parent disable and restore naturally', () => {
  const rows = [{ module: 'OPPORTUNITIES', enabled: false }, { module: 'PRODUCTS', enabled: false }, { module: 'SUPPORT_CASES', enabled: false }];
  const off = resolveModules(rows);
  for (const child of ['FORECASTING', 'SALES_PLANS', 'PRICE_EXCEPTIONS', 'SUPPORT_INBOX']) {
    assert.equal(off.configured.has(child), true, child);
    assert.equal(off.effective.has(child), false, child);
  }
  for (const independent of ['PROJECTS', 'DEMOS', 'TRADE_SHOWS', 'MARKETING']) assert.equal(off.effective.has(independent), true);
  const restored = resolveModules([]);
  for (const child of ['FORECASTING', 'SALES_PLANS', 'PRICE_EXCEPTIONS', 'SUPPORT_INBOX']) assert.equal(restored.effective.has(child), true);
});

test('small CRM deployment retains core and only Opportunities and Projects optional modules', () => {
  const kept = new Set(['OPPORTUNITIES', 'PROJECTS']);
  const availability = resolveModules(modules.filter(module => !kept.has(module)).map(module => ({ module, enabled: false })));
  assert.deepEqual([...availability.effective].sort(), [...kept].sort());
  assert.equal(reportTypeAvailable('PIPELINE', availability), true);
  assert.equal(reportTypeAvailable('ACCOUNT_ACTIVITY', availability), true);
  assert.equal(reportTypeAvailable('TRADE_SHOW', availability), false);
  assert.equal(builtInReportAvailable('DEMO_INVENTORY', availability), false);
  assert.equal(dashboardWidgetAvailable('SUPPORT_MY_OPEN', availability), false);
  assert.equal(dashboardWidgetAvailable('FORECAST_SUMMARY', availability), false);
});

test('Trade Show lead reports remain available without Opportunities while pipeline-only cards disappear', () => {
  const availability = resolveModules([{ module: 'OPPORTUNITIES', enabled: false }]);
  assert.equal(builtInReportAvailable('LEADS_BY_TRADE_SHOW', availability), true);
  assert.equal(builtInReportAvailable('TRADE_SHOW_PIPELINE', availability), false);
});

test('direct routes, saved views, and notification categories map to centralized module policy', () => {
  assert.equal(moduleForPath('/reports/pipeline-view'), 'OPPORTUNITIES');
  assert.equal(moduleForPath('/support/inbox'), 'SUPPORT_INBOX');
  assert.equal(moduleForPath('/reports/forecast-snapshots/export'), 'FORECASTING');
  assert.deepEqual(requiredModulesForPath('/opportunities/product-search?q=printer'), ['OPPORTUNITIES', 'PRODUCTS']);
  assert.deepEqual(requiredModulesForPath('/opportunities/price-exception-search'), ['OPPORTUNITIES', 'PRICE_EXCEPTIONS']);
  assert.deepEqual(requiredModulesForPath('/trade-shows/7/leads/9/convert'), ['TRADE_SHOWS', 'OPPORTUNITIES']);
  assert.deepEqual(requiredModulesForPath('/reports/lead-sources'), ['MARKETING', 'OPPORTUNITIES', 'TRADE_SHOWS']);
  assert.equal(moduleForSavedView('support-cases'), 'SUPPORT_CASES');
  assert.equal(moduleForNotificationCategory('PRICE_EXCEPTION'), 'PRICE_EXCEPTIONS');
  assert.equal(moduleForAuditEntity('Project'), 'PROJECTS');
  assert.equal(moduleForPath('/tasks/7'), null);
});

test('Admin quality checks respect optional parent data without hiding core checks', () => {
  const availability = resolveModules([{ module: 'OPPORTUNITIES', enabled: false }, { module: 'PROJECTS', enabled: false }]);
  assert.equal(qualityIssueAvailable('opportunity-owner', availability), false);
  assert.equal(qualityIssueAvailable('project-account', availability), false);
  assert.equal(qualityIssueAvailable('task-archived-link', availability), false);
  assert.equal(qualityIssueAvailable('account-owner', availability), true);
});
