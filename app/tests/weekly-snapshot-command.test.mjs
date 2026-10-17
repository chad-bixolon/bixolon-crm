import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const command = fileURLToPath(new URL('../scripts/weekly-snapshots.mjs', import.meta.url));
const secret = 'weekly-command-test-secret-never-log';
function run(preload, args = [], env = {}) {
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, command, ...args], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, SALESHUB_JOB_ORIGIN: 'https://jobs.example.test', WEEKLY_SNAPSHOT_SECRET: secret, ...env },
  });
  assert.ifError(result.error);
  return result;
}
test('production command authenticates POST and pins bounded partial-failure retries to the returned week', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import timers from 'node:timers/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const delays = []; timers.setTimeout = async ms => { delays.push(ms); }; syncBuiltinESMExports();
    let requests = 0;
    globalThis.fetch = async (url, options) => {
      requests++;
      assert.equal(String(url), 'https://jobs.example.test/api/internal/snapshots/weekly');
      assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, 'Bearer ' + process.env.WEEKLY_SNAPSHOT_SECRET);
      assert.deepEqual(JSON.parse(options.body), requests === 1 ? {} : { week: '2026-12-28' });
      return Response.json(requests < 3 ? { week: '2026-12-28', failureCategory: 'FORECAST_CAPTURE_FAILED' } : { status: 'SUCCEEDED', id: 1, opportunitySnapshotRunId: 2, forecastSnapshotRunId: 3 }, { status: requests < 3 ? 503 : 200 });
    };
    process.on('exit', () => { assert.equal(requests, 3); assert.deepEqual(delays, [5000, 10000]); });
  `);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /execution #1, Opportunity #2, Forecast #3/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
});
test('production command exits nonzero on unknown transport outcomes without leaking secrets or provider details', () => {
  const result = run(`globalThis.fetch = async () => { throw new Error(process.env.WEEKLY_SNAPSHOT_SECRET + ' private provider details'); };`);
  assert.equal(result.status, 1); assert.match(result.stderr, /Review Administration/); assert.ok(!result.stderr.includes(secret)); assert.ok(!result.stderr.includes('private provider'));
});
test('production command rejects unsafe configuration and does not retry incompatible history', () => {
  for (const env of [{ SALESHUB_JOB_ORIGIN: 'http://jobs.example.test' }, { SALESHUB_JOB_ORIGIN: 'https://user:password@jobs.example.test' }, { WEEKLY_SNAPSHOT_SECRET: '' }]) {
    const result = run(`globalThis.fetch = async () => { throw new Error('should never fetch'); };`, [], env);
    assert.equal(result.status, 1); assert.ok(!result.stderr.includes('should never fetch'));
  }
  const result = run(`
    import assert from 'node:assert/strict'; let requests = 0;
    globalThis.fetch = async (_, options) => { requests++; assert.deepEqual(JSON.parse(options.body), { week: '2026-12-28' }); return Response.json({ week: '2026-12-28', failureCategory: 'INCOMPATIBLE_SOURCE' }, { status: 503 }); };
    process.on('exit', () => assert.equal(requests, 1));
  `, ['2026-12-28']);
  assert.equal(result.status, 1); assert.match(result.stderr, /Weekly snapshots failed/);
});
