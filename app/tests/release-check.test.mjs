import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { assertClientAlignment, commandRunner, migrationChanged, parseOptions, parseUnitCounts, redact, runReleaseCheck, runtimeSupported } from '../scripts/release-check.mjs';

function fixture(t, { dirty = false, paths = [], fail, output, version = 'v22.23.3', mutate = false, allowDirty = false, focus = null } = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), 'saleshub-release-check-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [], environments = [];
  let inspections = 0;
  const repo = { commit: 'abc123', branch: 'main', baseline: 'def456', baselineRef: 'HEAD^', dirty, trackedModified: dirty, untracked: dirty, status: dirty ? 'M app/a.ts\n?? app/new.ts' : '', changedPaths: paths };
  const run = async (command, args, logPath, overrides) => {
    environments.push({ args, overrides });
    calls.push([command, args]);
    const key = [command, ...args].join(' ');
    if (fail && key.includes(fail)) return { code: 1, output: output ?? 'deliberate stage failure' };
    if (args[0] === '--version') return { code: 0, output: '10.9.8\n' };
    if (args[0] === 'test') return { code: 0, output: '# tests 12\n# pass 11\n# fail 0\n# skipped 1\n' };
    if (args.includes('release-smoke.spec.ts')) return { code: 0, output: '3 passed (10s)\n' };
    return { code: 0, output: '' };
  };
  return { calls, environments, directory, execute: () => runReleaseCheck({ base: 'HEAD^', allowDirty, focus }, { directory, nodeVersion: version, run, repository: async () => ({ ...repo, commit: mutate && inspections++ ? 'newcommit' : 'abc123' }), verifyClient: () => ({ schemaSha256: 'schema-hash', generatedClientVersion: '6.19.3' }), clean: value => redact(value, ['dummy-private-value']) }) };
}

test('successful orchestration emits READY JSON/text with identity, counts, durations, stage logs and reminders', async t => {
  const f = fixture(t);
  const result = await f.execute();
  assert.equal(result.result, 'READY');
  const json = JSON.parse(readFileSync(resolve(f.directory, 'release.json'), 'utf8'));
  const text = readFileSync(resolve(f.directory, 'release.txt'), 'utf8');
  assert.equal(json.formatVersion, 1);
  assert.equal(json.repository.commit, 'abc123');
  assert.equal(json.runtime.node, 'v22.23.3');
  assert.equal(json.runtime.npm, '10.9.8');
  assert.ok(json.timestamp && json.durationMs >= 0);
  assert.deepEqual(json.stages.find(stage => stage.name === 'Unit').counts, { passed: 11, failed: 0, skipped: 1, total: 12 });
  assert.match(text, /11 passed \/ 0 failed \/ 1 skipped/);
  assert.match(text, /READY FOR RELEASE/);
  assert.match(text, /External deployment\/provider state is NOT VERIFIED/);
  assert.ok(json.cleanup.length);
  assert.equal(existsSync(resolve(f.directory, 'temporary')), false);
  assert.deepEqual(f.calls.filter(([, args]) => args.includes('build')), [['npm', ['run', 'build', '--', '--webpack']]]);
  assert.ok(f.calls.some(([, args]) => args.join(' ') === 'run lint'));
  assert.ok(f.calls.some(([, args]) => args.join(' ') === 'run typecheck'));
  assert.ok(f.calls.some(([, args]) => args.join(' ') === 'test'));
  assert.equal(f.calls.some(([command]) => command === 'docker'), false);
  assert.equal(json.stages.find(stage => stage.name === 'Migrations').detail, 'Migration validation not required for this candidate');
});

for (const [failure, name] of [['run lint', 'Lint'], ['npm test', 'Unit'], ['run build', 'Production build'], ['release-smoke.spec.ts', 'Browser smoke']]) test(`${name} failure emits NOT READY and stops downstream work`, async t => {
  const f = fixture(t, { fail: failure });
  const result = await f.execute();
  assert.equal(result.result, 'NOT READY');
  assert.equal(result.stages.find(stage => stage.name === name).status, 'FAIL');
  assert.equal(result.stages.at(-1).status, 'NOT RUN');
  assert.match(readFileSync(resolve(f.directory, 'release.txt'), 'utf8'), /NOT READY/);
  assert.equal(existsSync(resolve(f.directory, 'temporary')), false);
});

test('dirty tracked/untracked work fails before running checks; explicit development validation never says READY', async t => {
  const denied = fixture(t, { dirty: true });
  assert.equal((await denied.execute()).stages[0].status, 'FAIL');
  assert.equal(denied.calls.length, 0);
  const allowed = fixture(t, { dirty: true, allowDirty: true });
  const result = await allowed.execute();
  assert.equal(result.result, 'NOT READY');
  assert.equal(result.stages.find(stage => stage.name === 'Production build').status, 'PASS');
  assert.ok(result.repository.trackedModified && result.repository.untracked);
});

test('schema and migration edits invoke current test-image build and existing replay/preservation/parity script', async t => {
  for (const path of ['app/prisma/schema.prisma', 'app/prisma/migrations/new/migration.sql', 'app/prisma.config.ts']) {
    const f = fixture(t, { paths: [path] });
    const result = await f.execute();
    assert.equal(result.result, 'READY');
    assert.equal(result.stages.find(stage => stage.name === 'Migrations').status, 'PASS');
    assert.ok(f.calls.some(([command, args]) => command === 'docker' && args.includes('bixolon-crm-foundation-test:local')));
    assert.ok(f.calls.some(([command, args]) => command === 'python3' && args[0] === 'scripts/test-migrations.py'));
  }
  assert.equal(migrationChanged(['app/lib/work.ts']), false);
});

test('unsupported runtime fails visibly without generation, tests or runtime switching', async t => {
  const f = fixture(t, { version: 'v20.19.2' });
  const result = await f.execute();
  assert.equal(result.result, 'NOT READY');
  assert.match(result.stages.find(stage => stage.name === 'Runtime').detail, /unsupported/);
  assert.equal(f.calls.some(([, args]) => args.includes('prisma:generate')), false);
  for (const version of ['22.12.0', 'v22.23.3', '22.99.0']) assert.equal(runtimeSupported(version, '>=22.12 <23'), true);
  for (const version of ['22.11.9', '23.0.0', '20.19.2', '22.12.0-rc.1']) assert.equal(runtimeSupported(version, '>=22.12 <23'), false);
  assert.equal(runtimeSupported('22.23.3', '^22'), false);
});

test('candidate mutation and missing unit totals fail closed', async t => {
  const changed = fixture(t, { mutate: true });
  const result = await changed.execute();
  assert.equal(result.result, 'NOT READY');
  assert.equal(result.stages.find(stage => stage.name === 'Final repository').status, 'FAIL');
  assert.ok(Number.isNaN(parseUnitCounts('not TAP').passed));
});

test('secret values are redacted in failure evidence, including credential URLs', async t => {
  const f = fixture(t, { fail: 'run lint', output: 'dummy-private-value postgresql://user:password@host/db?sslmode=require TOKEN=another-value' });
  await f.execute();
  for (const name of ['release.json', 'release.txt']) {
    const content = readFileSync(resolve(f.directory, name), 'utf8');
    for (const secret of ['dummy-private-value', 'another-value', 'user:password']) assert.equal(content.includes(secret), false);
    assert.match(content, /REDACTED/);
  }
});

test('real subprocess logging redacts a secret split across output chunks', async t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'saleshub-release-log-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = resolve(directory, 'stage.log');
  const run = commandRunner({ ...process.env, RELEASE_TEST_SECRET: 'dummy-private-value' }, value => redact(value, ['dummy-private-value']));
  const result = await run(process.execPath, ['-e', 'process.stdout.write(process.env.RELEASE_TEST_SECRET.slice(0,8)); setTimeout(() => process.stdout.write(process.env.RELEASE_TEST_SECRET.slice(8)+"\\n"), 10)'], log);
  assert.equal(result.code, 0);
  assert.equal(result.output, '[REDACTED]\n');
  assert.equal(readFileSync(log, 'utf8'), '[REDACTED]\n');
});

test('focus is a small explicit existing suite; invalid options/baselines cannot become commands', async t => {
  const f = fixture(t, { focus: 'support' });
  assert.equal((await f.execute()).result, 'READY');
  assert.ok(f.calls.some(([, args]) => args.includes('support-case-work.spec.ts') && args.includes('--workers=1')));
  assert.deepEqual(parseOptions(['--base', 'v1.2', '--allow-dirty', '--focus', 'snapshots']), { base: 'v1.2', allowDirty: true, focus: 'snapshots' });
  for (const args of [['--base'], ['--base', '--help'], ['--focus', 'anything'], ['--unknown']]) assert.throws(() => parseOptions(args));
});


test('client alignment rejects missing schema fields, stale embedded JS and mismatched runtime versions', () => {
  const normalized = 'model Currency { code String @id isDefault Boolean }';
  assert.doesNotThrow(() => assertClientAlignment(normalized, normalized, normalized, '6.19.3', '6.19.3'));
  assert.throws(() => assertClientAlignment(normalized, 'model Currency { code String @id }', normalized, '6.19.3', '6.19.3'), /schema\/runtime differs/);
  assert.throws(() => assertClientAlignment(normalized, normalized, 'model Currency { code String @id }', '6.19.3', '6.19.3'), /schema\/runtime differs/);
  assert.throws(() => assertClientAlignment(normalized, normalized, normalized, '6.19.3', '6.18.0'), /runtime version differs/);
});


test('failing unit totals are retained in machine-readable evidence', async t => {
  const f = fixture(t, { fail: 'npm test', output: '# tests 12\n# pass 10\n# fail 1\n# skipped 1\n' });
  const result = await f.execute();
  assert.equal(result.result, 'NOT READY');
  assert.deepEqual(result.stages.find(stage => stage.name === 'Unit').counts, { passed: 10, failed: 1, skipped: 1, total: 12 });
});


test('the release browser database override is confined to browser commands', async t => {
  const f = fixture(t, { focus: 'support' });
  await f.execute();
  for (const { args, overrides } of f.environments) {
    assert.equal(overrides?.E2E_DATABASE_NAME, args.includes('test:e2e') ? 'saleshub_e2e_release' : undefined);
  }
});
