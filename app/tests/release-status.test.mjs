import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';
import { createHash } from 'node:crypto';
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { migrationStatus, runtimeStatus, overallStatus, jobSummary, releaseStatus } = require('../lib/release-status.ts');
const checksum = 'a'.repeat(64), expected = [{ name: 'one', checksum }];
const applied = { migration_name: 'one', checksum, finished_at: new Date(), rolled_back_at: null };
test('migration verification checks names and checksums, pending, failed, rolled back and unavailable evidence', () => {
  assert.equal(migrationStatus(expected, [applied]).status, 'Up to date');
  assert.equal(migrationStatus(expected, []).status, 'Migration pending');
  assert.equal(migrationStatus(expected, [{ ...applied, finished_at: null }]).status, 'Migration failed');
  assert.equal(migrationStatus(expected, [{ ...applied, finished_at: null, rolled_back_at: new Date() }]).status, 'Migration pending');
  assert.equal(migrationStatus(expected, [{ ...applied, checksum: 'other' }]).status, 'Unable to verify');
  assert.equal(migrationStatus(expected, [applied, { ...applied, migration_name: 'extra' }]).status, 'Unable to verify');
  assert.equal(migrationStatus(null, null).status, 'Unable to verify');
});
test('runtime must match source, normalized generated schema, embedded runtime and pinned versions', () => {
  const hash = s => createHash('sha256').update(s).digest('hex');
  const m = { schemaHash: hash('source'), normalizedSchemaHash: hash('normalized'), prismaVersion: '6.19.3' };
  assert.equal(runtimeStatus(m, 'source', 'normalized', 'normalized', '6.19.3', '6.19.3'), 'Verified');
  for (const args of [['changed', 'normalized', 'normalized', '6.19.3', '6.19.3'], ['source', 'normalized', 'stale', '6.19.3', '6.19.3'], ['source', 'normalized', 'normalized', '6.19.3', '6.18.0']]) assert.equal(runtimeStatus(m, ...args), 'Attention needed');
  assert.equal(runtimeStatus(m, 'source', 'normalized', null, '6.19.3', '6.19.3'), 'Unable to verify');
});
test('overall verified requires identity and both core checks; unknowns never produce a false green', () => {
  assert.equal(overallStatus(true, 'Up to date', 'Verified'), 'Verified');
  assert.equal(overallStatus(false, 'Up to date', 'Verified'), 'Partially verified');
  assert.equal(overallStatus(false, 'Unable to verify', 'Unable to verify'), 'Unable to verify');
  assert.equal(overallStatus(true, 'Migration failed', 'Verified'), 'Attention needed');
  assert.equal(overallStatus(true, 'Migration pending', 'Verified'), 'Attention needed');
  assert.equal(overallStatus(true, 'Up to date', 'Attention needed'), 'Attention needed');
  assert.equal(overallStatus(true, 'Unable to verify', 'Verified'), 'Partially verified');
});
test('weekly and Calendar evidence distinguish successes, failures and no connection work', () => {
  assert.equal(jobSummary({ status: 'SUCCEEDED' }), 'Last run successful');
  assert.equal(jobSummary({ status: 'FAILED' }), 'Last run had failures');
  assert.equal(jobSummary({ status: 'SUCCEEDED', resultSummary: '8 of 8 connections succeeded.' }, true), 'Last run successful — 8 connections processed');
  assert.equal(jobSummary({ status: 'SUCCEEDED', resultSummary: '0 of 0 connections succeeded.' }, true), 'Last run completed — no active connections');
  assert.equal(jobSummary({ status: 'SUCCEEDED', resultSummary: '7 of 8 connections succeeded.' }, true), 'Last run had failures');
  assert.equal(jobSummary({ status: 'SUCCEEDED', resultSummary: 'SECRET' }, true), 'Last run completed — connection count unavailable');
  assert.equal(jobSummary(null), 'Unable to verify');
});
test('release reads deny non-Admin and impersonated effective users before accessing evidence', async () => {
  const db = new Proxy({}, { get() { throw Error('unexpected query'); } });
  for (const actor of [{ id: 1, role: 'SALES', active: true }, { id: 1, role: 'ADMIN', active: false }, { id: 2, role: 'SALES', active: true, realUser: { id: 1, role: 'ADMIN', active: true } }]) await assert.rejects(releaseStatus(db, actor), /Access denied/);
});
test('Gmail configuration and stored connection are read-only and fail safely', async () => {
  const { gmailStatus } = require('../lib/release-status.ts');
  assert.equal(await gmailStatus(false, () => { throw Error('must not read'); }), 'Not configured');
  assert.equal(await gmailStatus(true, async () => ({ connected: true })), 'Configured · connection recorded');
  assert.equal(await gmailStatus(true, async () => ({ connected: false })), 'Configured · not connected');
  assert.equal(await gmailStatus(true, async () => { throw Error('SECRET'); }), 'Configured · unable to verify connection');
});
test('running release resolves validated deployed identity and preserves build evidence', async t => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = fs;
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { Prisma } = require('@prisma/client');
  const temp = mkdtempSync(join(tmpdir(), 'release-status-test-')), cwd = process.cwd();
  const savedEnv = { RELEASE_GIT_SHA: process.env.RELEASE_GIT_SHA, RELEASE_BRANCH: process.env.RELEASE_BRANCH };
  const hash = s => createHash('sha256').update(s).digest('hex');
  const buildSha = 'a'.repeat(40), runtimeSha = 'B'.repeat(40), builtAt = '2026-10-21T12:34:56.000Z';
  const manifest = { format: 1, commit: buildSha, branch: 'build-branch', builtAt, version: '0.1.0', migrations: expected, schemaHash: hash('source'), normalizedSchemaHash: hash('normalized'), prismaVersion: Prisma.prismaVersion.client };
  const setEnv = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  try {
    process.chdir(temp);
    for (const dir of ['prisma', 'node_modules/.prisma/client', 'node_modules/@prisma/client']) mkdirSync(dir, { recursive: true });
    writeFileSync('prisma/schema.prisma', 'source');
    writeFileSync('node_modules/.prisma/client/schema.prisma', 'normalized');
    writeFileSync('node_modules/@prisma/client/package.json', JSON.stringify({ version: Prisma.prismaVersion.client }));
    const db = { $queryRaw: async () => [applied], _engineConfig: { inlineSchema: 'normalized' } }, actor = { id: 1, role: 'ADMIN', active: true };
    const cases = [
      { name: 'runtime SHA overrides build SHA', runtime: runtimeSha, build: buildSha, commit: runtimeSha },
      { name: 'runtime SHA works when build identity is missing', runtime: runtimeSha, build: null, commit: runtimeSha },
      { name: 'build SHA is used when runtime SHA is absent', build: buildSha, commit: buildSha },
      { name: 'empty runtime SHA falls back to build', runtime: '', build: buildSha, commit: buildSha },
      { name: 'malformed runtime SHA falls back to valid build', runtime: 'PRIVATE_INVALID_SHA', build: buildSha, commit: buildSha },
      ...['PRIVATE_INVALID_SHA', '${_self.COMMIT_HASH}', 'a'.repeat(7), 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(64), 'g'.repeat(40), ` ${runtimeSha}`, `${runtimeSha}\n`].map(runtime => ({ name: `malformed runtime (${JSON.stringify(runtime)}) cannot verify without build SHA`, runtime, build: null, commit: null })),
      { name: 'missing SHA cannot verify', build: null, commit: null },
      { name: 'malformed build SHA cannot verify', build: 'a'.repeat(64), commit: null },
    ];
    for (const c of cases) await t.test(c.name, async () => {
      setEnv('RELEASE_GIT_SHA', c.runtime); setEnv('RELEASE_BRANCH', undefined);
      writeFileSync('release-metadata.json', JSON.stringify({ ...manifest, commit: c.build }));
      const release = await releaseStatus(db, actor);
      assert.equal(release.commit, c.commit);
      assert.equal(release.branch, 'build-branch');
      assert.equal(release.builtAt, builtAt);
      assert.equal(release.migrations.status, 'Up to date');
      assert.equal(release.runtime, 'Verified');
      assert.equal(release.overall, c.commit ? 'Verified' : 'Partially verified');
      assert.equal(JSON.stringify(release).includes('PRIVATE_INVALID_SHA'), false);
      assert.deepEqual(JSON.parse(fs.readFileSync('release-metadata.json', 'utf8')), { ...manifest, commit: c.build });
    });
    await t.test('runtime branch overrides build branch, remains optional and hides invalid values', async () => {
      setEnv('RELEASE_GIT_SHA', runtimeSha);
      writeFileSync('release-metadata.json', JSON.stringify(manifest));
      for (const branch of ['main', 'feature/release_identity-1.0']) {
        setEnv('RELEASE_BRANCH', branch);
        assert.equal((await releaseStatus(db, actor)).branch, branch);
      }
      for (const branch of ['', 'PRIVATE BRANCH SECRET', '<script>secret</script>', 'main\n', 'a'.repeat(121)]) {
        setEnv('RELEASE_BRANCH', branch);
        const release = await releaseStatus(db, actor);
        assert.equal(release.branch, 'build-branch');
        assert.equal(release.overall, 'Verified');
      }
      writeFileSync('release-metadata.json', JSON.stringify({ ...manifest, branch: null }));
      setEnv('RELEASE_BRANCH', undefined);
      const release = await releaseStatus(db, actor);
      assert.equal(release.branch, null);
      assert.equal(release.overall, 'Verified');
      assert.equal(release.builtAt, builtAt);
    });
    await t.test('runtime identity cannot replace missing schema and migration evidence', async () => {
      writeFileSync('release-metadata.json', 'invalid');
      setEnv('RELEASE_GIT_SHA', runtimeSha);
      assert.equal((await releaseStatus(db, actor)).commit, runtimeSha);
      assert.equal((await releaseStatus(db, actor)).overall, 'Partially verified');
      setEnv('RELEASE_GIT_SHA', undefined);
      assert.equal((await releaseStatus(db, actor)).overall, 'Unable to verify');
    });
  } finally {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(savedEnv)) setEnv(key, value);
    rmSync(temp, { recursive: true, force: true });
  }
});
