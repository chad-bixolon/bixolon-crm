import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = Module.createRequire(import.meta.url);
const originalLoad = Module._load;
const originalTs = Module._extensions['.ts'];
const originalTsx = Module._extensions['.tsx'];
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const releaseLogic = require('../lib/release-status.ts');
const actor = { id: 1, role: 'ADMIN', active: true };
const at = new Date('2026-10-22T12:00:00Z');
const release = { commit: 'abcdef1234'.repeat(4), branch: 'main', builtAt: at.toISOString(), version: '0.1.0', migrations: { status: 'Up to date', expected: 20, applied: 20, failed: 0 }, runtime: 'Verified', overall: 'Verified', checkedAt: at };
const manifest = { format: 2, commit: release.commit, builtAt: release.builtAt, version: release.version, prismaVersion: '6.19.3', schemaHash: 'a'.repeat(64), normalizedSchemaHash: 'b'.repeat(64), migrations: [] };
let calendar = { status: 'SUCCEEDED', startedAt: at, resultSummary: '1 of 1 connections succeeded.' };
let weekly = { status: 'SUCCEEDED', startedAt: at, opportunitySnapshotRunId: 7, forecastSnapshotRunId: 8, forecastSnapshotRun: { year: 2026, quarter: 4 } };
let gmail = 'Configured · connection recorded';
let history = [{ jobType: 'WEEKLY_SNAPSHOTS', successful: { completedAt: at } }, { jobType: 'SUPPORT_GMAIL', successful: { completedAt: at } }];
Module._load = function(specifier, parent, isMain) {
  if (specifier === 'next/link') return function MockLink({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (specifier === '@/lib/release-status') return { ...releaseLogic, releaseStatus: async () => release, readManifest: () => manifest, gmailStatus: async () => gmail };
  if (specifier === '@/lib/prisma') return { prisma: { scheduledJobRun: { findFirst: async ({ where }) => where.jobType === 'WEEKLY_SNAPSHOTS' ? weekly : where.status === 'SUCCEEDED' ? { completedAt: at } : calendar } } };
  if (specifier === '@/lib/admin-integration-history') return { durableIntegrationHealth: async () => history, safeAttemptFailure: () => 'Review the connection.' };
  if (specifier === '@/lib/support-gmail-connection') return { supportGmailClientConfigured: () => true, connectionStatus: async () => ({ connected: true }) };
  if (specifier.startsWith('@/')) return originalLoad.call(this, `../${specifier.slice(2)}.ts`, parent, isMain);
  return originalLoad.call(this, specifier, parent, isMain);
};
const { DeploymentStatus, ReleaseStatus } = require('../components/release-status.tsx');
Module._load = originalLoad;
Module._extensions['.ts'] = originalTs;
Module._extensions['.tsx'] = originalTsx;
const renderDeployment = overrides => renderToStaticMarkup(React.createElement(DeploymentStatus, { release: { ...release, ...overrides }, manifest }));
const render = async () => renderToStaticMarkup(await ReleaseStatus({ actor }));
const primary = html => html.split('<details')[0];

test('deployment summaries follow all existing results without falsely claiming verification', () => {
  const cases = [['Verified', 'SalesHub is running the expected application and database versions.'], ['Attention needed', 'The application or database needs attention.'], ['Partially verified', 'Some deployment checks passed'], ['Unable to verify', 'SalesHub could not confirm']];
  for (const [overall, text] of cases) {
    const html = primary(renderDeployment({ overall }));
    assert.ok(html.includes(text));
    if (overall !== 'Verified') assert.ok(!html.includes(cases[0][1]));
  }
});
test('Admin labels preserve short/full identity and put technical evidence in a closed disclosure', () => {
  const html = renderDeployment({}); const main = primary(html);
  assert.match(main, /Deployed version<\/dt><dd[^>]*title="abcdef1234abcdef1234abcdef1234abcdef1234">abcdef1234<\/dd>/);
  for (const label of ['Source branch', 'Deployed', 'SalesHub version', 'Database updates', 'Current', 'Application &amp; database compatibility', 'Last checked']) assert.ok(main.includes(label));
  assert.doesNotMatch(main, /Migration counts|Prisma|fingerprint/);
  assert.match(html, /<details class="mt-3 text-sm"><summary[^>]*>Technical details<\/summary>/);
  for (const evidence of ['20 expected · 20 applied · 0 failed', 'Full commit SHA', 'Expected Prisma client version', 'Running Prisma client/runtime version', manifest.schemaHash, manifest.normalizedSchemaHash, 'npm run release:check']) assert.ok(html.includes(evidence));
  assert.match(html, /actual deployment time is not recorded/);
});
test('database and compatibility failures stay visible with details closed', () => {
  for (const [status, label] of [['Migration pending', 'Pending'], ['Migration failed', 'Failed'], ['Unable to verify', 'Unable to verify']]) assert.match(primary(renderDeployment({ migrations: { status, expected: 20, applied: 19, failed: 1 }, overall: 'Attention needed' })), new RegExp(`Database updates</dt><dd[^>]*>${label}</dd>`));
  for (const runtime of ['Attention needed', 'Unable to verify']) {
    const main = primary(renderDeployment({ runtime, overall: runtime }));
    assert.ok(main.includes(`${runtime} —`)); assert.match(main, /Contact your system maintainer/); assert.doesNotMatch(main, /Prisma|schema/);
  }
  assert.match(primary(renderDeployment({ commit: null })), /Deployed version<\/dt><dd[^>]*>Unable to verify/);
});
test('successful jobs show one timestamp and correct Calendar grammar without exposing unknown summaries', async () => {
  const html = await render(); const operational = html.split('<article')[1];
  assert.match(operational, /Weekly Sales Snapshots/); assert.match(operational, /Status: Healthy/); assert.match(operational, /Last completed:/); assert.doesNotMatch(operational, /Latest attempt|Last attempt|Last success/);
  assert.match(html, /1 calendar connection processed/); assert.doesNotMatch(html, /1 calendar connections processed/); assert.match(html, /Gmail connected/); assert.match(html, /Last successful activity/); assert.match(html, /No unresolved errors/);
  assert.match(html, /href="\/reports\/opportunity-snapshots\?after=7"/); assert.match(html, /href="\/reports\/forecast-snapshots\?after=8&amp;year=2026&amp;quarter=4"/);
  calendar = { ...calendar, resultSummary: '8 of 8 connections succeeded.' }; assert.match(await render(), /8 calendar connections processed/);
  calendar = { ...calendar, resultSummary: '0 of 0 connections succeeded.' }; assert.match(await render(), /no active connections/);
  calendar = { ...calendar, resultSummary: 'PRIVATE_PROVIDER_PAYLOAD' }; const unknown = await render(); assert.match(unknown, /connection count unavailable/); assert.doesNotMatch(unknown, /PRIVATE_PROVIDER_PAYLOAD/);
});
test('failed and unknown operational evidence stays visible with recovery context', async () => {
  calendar = { ...calendar, status: 'FAILED' }; weekly = { ...weekly, status: 'FAILED', failureCategory: 'AUTHENTICATION' }; history[1] = { ...history[1], failed: { startedAt: at, failureCategory: 'AUTHENTICATION' } };
  const html = await render(); assert.equal((html.match(/Latest failed attempt:/g) ?? []).length, 2); assert.equal((html.match(/Most recent successful completion:/g) ?? []).length, 2); assert.match(html, /Status: Attention needed/); assert.match(html, /Latest unresolved error:/); assert.doesNotMatch(html, /No unresolved errors/);
  calendar = null; weekly = null; gmail = 'Configured · unable to verify connection'; history = null;
  const unavailable = await render(); assert.match(unavailable, /Status: Unable to verify/); assert.match(unavailable, /Activity history unavailable/); assert.doesNotMatch(unavailable, /Status: Healthy|No unresolved errors/);
});
