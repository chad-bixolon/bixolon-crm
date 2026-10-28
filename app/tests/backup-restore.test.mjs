import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { backup, backupConfig, backupKeys } from '../scripts/operations/backup-postgres.mjs';
import { download, restore, restoreKey, restoreTarget } from '../scripts/operations/restore-postgres.mjs';
import { connection, pgEnvironment, recoveryLogger, runPg, sha256, temporary } from '../scripts/operations/recovery-common.mjs';
import { spacesConfig, spacesStore, verifyRemote } from '../scripts/operations/backup-spaces.mjs';

const env = {
  BACKUP_DATABASE_URL: 'postgresql://reader:p%24%28secret%29@prod.example.test/saleshub?sslmode=verify-full&sslrootcert=/tmp/ca.crt&connection_limit=4',
  BACKUP_DATABASE_NAME: 'saleshub', BACKUP_ENVIRONMENT: 'prod', BACKUP_DOCUMENTS_BUCKET: 'saleshub-documents',
  BACKUP_SPACES_REGION: 'atl1', BACKUP_SPACES_ENDPOINT: 'https://atl1.digitaloceanspaces.com',
  BACKUP_SPACES_BUCKET: 'saleshub-backups', BACKUP_SPACES_ACCESS_KEY_ID: 'secret-key-id', BACKUP_SPACES_SECRET_ACCESS_KEY: 'secret-key-value',
  BACKUP_MAX_DUMP_BYTES: '1048576', RELEASE_GIT_SHA: 'a'.repeat(40),
};
const targetEnv = {
  ...env, RESTORE_PRODUCTION_DATABASE_URL: 'postgresql://identity@prod.example.test/saleshub',
  RESTORE_TARGET_DATABASE_URL: 'postgresql://test:test@127.0.0.1:55439/saleshub_restore_test?sslmode=disable',
  RESTORE_CONFIRM: 'restore-disposable-database',
};
const runId = '11111111-2222-4333-8444-555555555555';
const key = backupKeys('prod', new Date('2026-10-28T02:00:00Z'), runId)[0];
const digest = body => createHash('sha256').update(body).digest('hex');
async function context(t) {
  const root = await mkdtemp(join(tmpdir(), 'saleshub-recovery-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lines = []; const commands = []; const objects = new Map();
  const store = {
    async put(key, file, size, metadata) { objects.set(key, { body: await readFile(file), size, metadata }); },
    async head(key) { const obj = objects.get(key); if (!obj) throw Error('secret-url'); return { size: obj.size, metadata: obj.metadata }; },
    async get(key) { return Readable.from([objects.get(key).body]); },
  };
  const pg = async (command, args, options) => {
    commands.push({ command, args, options });
    if (args[0] === '--version') return 'pg_dump (PostgreSQL) 17.6';
    if (command === 'pg_dump') { await writeFile(options.file, 'PGDMP synthetic fixture', { mode: 0o600 }); return ''; }
    if (command === 'psql') return '0';
    return '';
  };
  return { root, lines, commands, objects, store, pg,
    log: recoveryLogger(line => lines.push(JSON.parse(line))),
    env: { ...env, BACKUP_TEMP_DIR: root },
  };
}

test('configuration fails closed and confines destination and database', () => {
  assert.equal(backupConfig(env).c.database, 'saleshub');
  for (const name of ['BACKUP_DATABASE_URL', 'BACKUP_DATABASE_NAME', 'BACKUP_ENVIRONMENT', 'BACKUP_DOCUMENTS_BUCKET', 'BACKUP_SPACES_BUCKET', 'BACKUP_SPACES_REGION', 'BACKUP_SPACES_ENDPOINT', 'BACKUP_SPACES_ACCESS_KEY_ID', 'BACKUP_SPACES_SECRET_ACCESS_KEY']) {
    assert.throws(() => backupConfig({ ...env, [name]: '' }));
  }
  for (const overrides of [
    { BACKUP_DATABASE_NAME: 'another_db' }, { BACKUP_ENVIRONMENT: '../prod' },
    { BACKUP_SPACES_BUCKET: env.BACKUP_DOCUMENTS_BUCKET }, { SPACES_BUCKET: env.BACKUP_SPACES_BUCKET },
    { BACKUP_SPACES_ENDPOINT: 'https://evil.test' }, { BACKUP_SPACES_ENDPOINT: 'http://atl1.digitaloceanspaces.com' },
    { BACKUP_MAX_DUMP_BYTES: '-1' }, { BACKUP_MAX_DUMP_BYTES: '2147483649' }, { RELEASE_GIT_SHA: 'contains secrets' },
    { BACKUP_DATABASE_URL: env.BACKUP_DATABASE_URL.replace('verify-full', 'require') },
  ]) assert.throws(() => backupConfig({ ...env, ...overrides }));
  for (const url of ['postgresql://u:p@host/a=b', 'postgresql://u:p@host/db?options=-c%20evil', 'postgresql://u:p@host/db?host=evil', 'postgresql://u:p@host/db?sslmode=require&sslmode=disable', 'postgresql://u:p@host/db%0a']) assert.throws(() => connection(url));
  assert.equal(spacesConfig(env).bucket, 'saleshub-backups');
});

test('backup naming is safe, unique, UTC and promotes Sunday/first-of-month from one dump', () => {
  assert.match(key, /^postgres\/daily\/saleshub-prod-2026-10-28T020000Z-[0-9a-f-]+\.dump$/);
  assert.equal(backupKeys('prod', new Date('2026-11-01T02:00:00Z'), runId).length, 3);
  assert.equal(backupKeys('prod', new Date('2026-12-01T02:00:00Z'), runId).length, 2);
  assert.throws(() => backupKeys('prod/../../x', new Date(), runId));
  assert.throws(() => backupKeys('prod', new Date(), 'bad/../id'));
});

test('backup verifies archive and remote bytes, records metadata, logs twice and removes private temp file', async t => {
  const c = await context(t);
  const result = await backup(c.env, { store: c.store, runPg: c.pg, log: c.log, now: new Date('2026-11-01T02:00:00Z') });
  assert.equal(c.objects.size, 3);
  assert.equal(c.commands.filter(x => x.command === 'pg_dump' && !x.args.includes('--version')).length, 1);
  const dumped = c.commands.find(x => x.options?.file);
  assert.ok(dumped.args.includes('--format=custom'));
  assert.equal(dumped.options.readOnly, true);
  assert.ok(c.commands.some(x => x.command === 'pg_restore' && x.args[0] === '--list'));
  const object = c.objects.get(result.objectKey);
  assert.equal(object.metadata['git-sha'], 'a'.repeat(40));
  assert.equal(object.metadata.database, 'saleshub');
  assert.equal(object.metadata['dump-format'], 'custom');
  assert.equal(object.metadata['pg-dump-version'], '17.6');
  assert.equal(object.metadata.sha256, digest(object.body));
  assert.equal(result.sizeBytes, object.body.length);
  assert.deepEqual(c.lines.map(x => x.event), ['backup.started', 'backup.completed']);
  assert.deepEqual(await readdir(c.root), []);
});

test('failure stages never emit success and clean partial files, including dump, disk, archive, upload and read-back failures', async t => {
  for (const stage of ['pg-dump', 'temp-limit', 'archive', 'spaces-upload', 'spaces-verification']) {
    const c = await context(t);
    const pg = async (...args) => {
      const result = await c.pg(...args);
      const [command, argv] = args;
      if ((['pg-dump', 'temp-limit'].includes(stage) && command === 'pg_dump' && !argv.includes('--version')) || (stage === 'archive' && command === 'pg_restore')) {
        const error = new Error('postgresql://password:secret@host secret-key-value signed?X-Amz-Signature=secret');
        if (stage === 'temp-limit') error.stage = 'temp-limit';
        // The real size limiter raises a RecoveryError (exercised below).
        if (stage !== 'temp-limit') throw error;
        const { RecoveryError } = await import('../scripts/operations/recovery-common.mjs');
        throw new RecoveryError('temp-limit');
      }
      return result;
    };
    if (stage === 'spaces-upload') c.store.put = async () => { throw new Error('secret-key-value'); };
    if (stage === 'spaces-verification') c.store.get = async () => Readable.from(['corrupt']);
    await assert.rejects(backup(c.env, { store: c.store, runPg: pg, log: c.log }));
    assert.deepEqual(c.lines.map(x => x.event), ['backup.started', 'backup.failed']);
    assert.equal(c.lines[1].stage, stage);
    assert.doesNotMatch(JSON.stringify(c.lines), /password|secret-key|Signature/);
    assert.deepEqual(await readdir(c.root), []);
  }
});

test('restore guards production, aliases/remote targets, development targets, missing identity and unconfirmed clean', () => {
  assert.equal(restoreTarget(targetEnv).database, 'saleshub_restore_test');
  for (const overrides of [
    { RESTORE_PRODUCTION_DATABASE_URL: '' }, { RESTORE_TARGET_DATABASE_URL: '' }, { RESTORE_CONFIRM: '' },
    { RESTORE_TARGET_DATABASE_URL: env.BACKUP_DATABASE_URL },
    { RESTORE_TARGET_DATABASE_URL: 'postgresql://test:test@prod.example.test/other' },
    { RESTORE_TARGET_DATABASE_URL: 'postgresql://test:test@other.ondigitalocean.com:25060/saleshub_restore_test' },
    { RESTORE_TARGET_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/saleshub_restore_test' },
    { RESTORE_TARGET_DATABASE_URL: 'postgresql://test:test@127.0.0.1:55439/bixolon_crm' },
    { DATABASE_URL: targetEnv.RESTORE_TARGET_DATABASE_URL },
    { RESTORE_MODE: 'clean' }, { RESTORE_MODE: 'anything' },
    { RESTORE_PRODUCTION_DATABASE_URL: 'postgresql://identity@127.0.0.1/prod' },
  ]) assert.throws(() => restoreTarget({ ...targetEnv, ...overrides }));
  assert.ok(restoreTarget({ ...targetEnv, RESTORE_MODE: 'clean', RESTORE_ALLOW_CLEAN: 'replace-disposable-objects' }));
});

test('restore checks checksum before touching target and uses single transaction without ownership/ACLs', async t => {
  const c = await context(t);
  const b = await backup(c.env, { store: c.store, runPg: c.pg, log: c.log });
  c.commands.length = 0;
  const restoreEnv = { ...targetEnv, BACKUP_TEMP_DIR: c.root, RESTORE_OBJECT_KEY: b.objectKey, RESTORE_EXPECTED_SHA256: b.sha256 };
  await restore(restoreEnv, { store: c.store, runPg: c.pg, log: c.log });
  const call = c.commands.find(x => x.command === 'pg_restore' && !x.args.includes('--list'));
  for (const arg of ['--single-transaction', '--no-owner', '--no-privileges', '--exit-on-error']) assert.ok(call.args.includes(arg));
  assert.equal(call.args.includes('--clean'), false);
  assert.equal(call.args.includes('--create'), false);
  assert.deepEqual(await readdir(c.root), []);
  c.commands.length = 0;
  await assert.rejects(restore({ ...restoreEnv, RESTORE_EXPECTED_SHA256: 'f'.repeat(64) }, { store: c.store, runPg: c.pg, log: c.log }));
  assert.equal(c.commands.length, 0);
  assert.equal(c.lines.at(-1).stage, 'checksum');
  assert.deepEqual(await readdir(c.root), []);
  c.store.get = async () => Readable.from(['corruption']);
  await assert.rejects(restore(restoreEnv, { store: c.store, runPg: c.pg, log: c.log }));
  assert.equal(c.commands.length, 0);
  assert.deepEqual(await readdir(c.root), []);
});

test('nonempty target refused; explicit clean includes flags; restore failure is unambiguous and cleans up', async t => {
  const c = await context(t);
  const b = await backup(c.env, { store: c.store, runPg: c.pg, log: c.log });
  const restoreEnv = { ...targetEnv, BACKUP_TEMP_DIR: c.root, RESTORE_OBJECT_KEY: b.objectKey, RESTORE_EXPECTED_SHA256: b.sha256 };
  await assert.rejects(restore(restoreEnv, { store: c.store, log: c.log, runPg: async (cmd, args, options) => cmd === 'psql' ? '5' : c.pg(cmd, args, options) }));
  assert.equal(c.lines.at(-1).stage, 'target-not-empty');
  await restore({ ...restoreEnv, RESTORE_MODE: 'clean', RESTORE_ALLOW_CLEAN: 'replace-disposable-objects' }, { store: c.store, runPg: c.pg, log: c.log });
  assert.ok(c.commands.some(x => x.args.includes('--clean') && x.args.includes('--if-exists')));
  await assert.rejects(restore(restoreEnv, { store: c.store, log: c.log, runPg: async (cmd, args, options) => {
    if (cmd === 'pg_restore' && !args.includes('--list')) throw new Error('secret SQL');
    return c.pg(cmd, args, options);
  } }));
  assert.equal(c.lines.at(-1).stage, 'restore');
  assert.deepEqual(await readdir(c.root), []);
});

test('checksum rejects truncated, changed or empty remote files and streams download with bounded size', async t => {
  const c = await context(t); const body = Buffer.from('fixture'); const expected = digest(body);
  c.objects.set(key, { body, size: body.length, metadata: { sha256: expected } });
  await verifyRemote(c.store, key, body.length, expected);
  const file = join(c.root, 'download.dump');
  await download(c.store, key, file, 100, expected);
  assert.equal(await sha256(file), expected);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  c.objects.get(key).body = Buffer.from('fixturn');
  await assert.rejects(verifyRemote(c.store, key, body.length, expected));
  c.objects.get(key).size = 0;
  await assert.rejects(download(c.store, key, join(c.root, 'empty.dump'), 100, expected));
  await assert.rejects(temporary(c.env, Number.MAX_SAFE_INTEGER, () => assert.fail('insufficient space must stop before action')));
});

test('operational logger only accepts fixed fields; arbitrary secrets and getters never serialize', () => {
  const lines = []; const log = recoveryLogger(line => lines.push(JSON.parse(line)));
  const fields = { runId, objectKey: key, durationMs: 1, sizeBytes: 10, sha256: 'a'.repeat(64), stage: 'restore', DATABASE_URL: env.BACKUP_DATABASE_URL, password: 'secret', error: new Error('secret') };
  Object.defineProperty(fields, 'message', { get() { throw new Error('must not execute'); } });
  log('backup.completed', fields);
  log('backup.failed', { objectKey: 'https://signed-secret-url', stage: 'password=secret' });
  assert.equal(lines[0].objectKey, key);
  assert.equal(lines[1].objectKey, undefined);
  assert.doesNotMatch(JSON.stringify(lines), /secret|password|DATABASE_URL/);
  const hostile = { toString() { throw new Error('must not coerce arbitrary objects'); }, toJSON() { return 'review-secret-placeholder'; } };
  log('backup.completed', { runId: hostile, sha256: hostile, objectKey: hostile });
  log(hostile, {});
  assert.equal(lines.length, 3);
  assert.equal(lines[2].objectKey, undefined);
  assert.doesNotMatch(JSON.stringify(lines), /review-secret-placeholder/);
});

test('Postgres command arguments and environment isolate credentials and do not invoke a shell', async t => {
  const c = await context(t);
  const executable = join(c.root, 'pg_dump');
  await writeFile(executable, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),user:process.env.PGUSER,password:process.env.PGPASSWORD,options:process.env.PGOPTIONS,inherited:process.env.DATABASE_URL}));\n`);
  await chmod(executable, 0o700);
  const previousPath = process.env.PATH;
  process.env.PATH = c.root;
  t.after(() => { process.env.PATH = previousPath; });
  const db = connection('postgresql://u%3B%24%28touch%20INJECTED%29:p%24%28id%29@host/db?sslmode=require');
  const output = JSON.parse(await runPg('pg_dump', ['--version', ';touch INJECTED', '$(id)'], { c: db, readOnly: true, capture: true }));
  assert.deepEqual(output.args, ['--version', ';touch INJECTED', '$(id)']);
  assert.equal(output.user, 'u;$(touch INJECTED)');
  assert.equal(output.password, 'p$(id)');
  assert.equal(output.inherited, undefined);
  assert.match(output.options, /default_transaction_read_only=on/);
  assert.equal(pgEnvironment(db).PGSERVICE, undefined);
  assert.equal((await readdir(c.root)).includes('INJECTED'), false);
  await writeFile(executable, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(1024));\n`);
  await assert.rejects(runPg('pg_dump', [], { file: join(c.root, 'limited.dump'), maxBytes: 100 }), error => error.stage === 'temp-limit');
});

test('Spaces adapter sends private bounded PUT, HEAD and streamed GET without bucket mutation or deletion', async t => {
  const c = await context(t); const requests = [];
  const file = join(c.root, 'upload.dump'); await writeFile(file, 'fixture');
  let destroyed = false;
  const store = spacesStore(spacesConfig(env), undefined, {
    async send(command) {
      requests.push(command);
      if (command.constructor.name === 'PutObjectCommand') {
        for await (const chunk of command.input.Body) assert.ok(chunk.length);
        return {};
      }
      if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: 7, Metadata: { sha256: digest('fixture') } };
      return { Body: Readable.from(['fixture']) };
    },
    destroy() { destroyed = true; },
  });
  await store.put(key, file, 7, { sha256: digest('fixture') });
  await verifyRemote(store, key, 7, digest('fixture'));
  assert.deepEqual(requests.map(x => x.constructor.name), ['PutObjectCommand', 'HeadObjectCommand', 'GetObjectCommand']);
  assert.equal(requests[0].input.ACL, 'private');
  assert.equal(requests[0].input.ContentLength, 7);
  assert.ok(requests.every(x => x.input.Bucket === 'saleshub-backups' && x.input.Key === key));
  store.close(); assert.equal(destroyed, true);
});

test('CLIs fail closed with nonzero exit and fixed JSON events without reading app dotenv', () => {
  for (const name of ['backup', 'restore']) {
    const result = spawnSync(process.execPath, [`scripts/operations/${name}-postgres.mjs`], { cwd: new URL('..', import.meta.url),
      encoding: 'utf8', env: { PATH: process.env.PATH, DATABASE_URL: 'postgresql://password:secret@production/db' },
    });
    assert.equal(result.status, 1);
    const lines = (result.stdout + result.stderr).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(x => x.event), [`${name}.started`, `${name}.failed`]);
    assert.equal(lines[1].stage, 'configuration');
    assert.doesNotMatch(JSON.stringify(lines), /password|secret|postgresql/);
  }
});

test('separate operations runtime locks Node and Prisma versions without changing the web runtime', async () => {
  const root = new URL('..', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('scripts/operations/recovery-runtime/package.json', root)));
  const lock = JSON.parse(await readFile(new URL('scripts/operations/recovery-runtime/package-lock.json', root)));
  assert.equal(manifest.engines.node, '>=22.23.4 <23');
  for (const name of ['prisma', '@prisma/client']) {
    assert.equal(manifest.dependencies[name], '6.19.3');
    assert.equal(lock.packages[`node_modules/${name}`].version, '6.19.3');
  }
  assert.equal(lock.packages['node_modules/deepmerge-ts'].version, '8.0.2');
  const dockerfile = await readFile(new URL('Dockerfile.operations', root), 'utf8');
  assert.match(dockerfile, /FROM node:22\.23\.4-bookworm-slim/);
  assert.match(dockerfile, /FROM postgres:17-bookworm/);
  assert.match(dockerfile, /USER postgres/);
});

test('production identity loopback aliases fail closed across encoding, casing, IPv4 and IPv6 spellings', () => {
  const hosts = ['localhost', 'LOCALHOST.', '%6cocalhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback', 'db.localhost', '127.0.0.1', '127.1', '127.000.000.001',
    '0177.0.0.1', '0x7f000001', '2130706433', '%31%32%37.0.0.1', '127.0.0.2',
    '[::1]', '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]', '0.0.0.0', '[::]'];
  for (const host of hosts) {
    for (const port of ['', ':5432', ':05432', ':55439', ':25060']) {
      assert.throws(() => restoreTarget({ ...targetEnv,
        RESTORE_PRODUCTION_DATABASE_URL: `postgresql://identity@${host}${port}/other_database`,
      }), { stage: 'target-guard' }, `accepted protected host ${host}${port}`);
    }
  }
});

test('equivalent app/backup connection identities cannot bypass the protected-database comparison', () => {
  const hosts = ['localhost', 'LOCALHOST.', '%6cocalhost', '127.1', '0177.0.0.1', '0x7f000001', '2130706433', '[::1]', '[::ffff:127.0.0.1]'];
  for (const name of ['DATABASE_URL', 'BACKUP_DATABASE_URL']) {
    for (const host of hosts) {
      assert.throws(() => restoreTarget({ ...targetEnv,
        [name]: `postgres://different_user:fixture@${host}:055439/%73aleshub_restore_test?schema=public&connection_limit=4`,
      }), { stage: 'target-guard' });
    }
  }
  // Equivalent safe target spellings normalize to the same actual numeric peer.
  for (const host of ['localhost', 'LOCALHOST.', '%6cocalhost', '127.1', '2130706433', '0177.0.0.1']) {
    assert.equal(restoreTarget({ ...targetEnv, RESTORE_TARGET_DATABASE_URL: `postgresql://test@${host}:055439/%73aleshub_restore_test` }).host, '127.0.0.1');
  }
  assert.equal(restoreTarget({ ...targetEnv, RESTORE_TARGET_DATABASE_URL: 'postgresql://test@[0:0:0:0:0:0:0:1]:55439/saleshub_restore_test' }).host, '::1');
});

test('ambiguous URL syntax, whitespace, query overrides and remote aliases are rejected safely', () => {
  const malformed = [
    ` ${targetEnv.RESTORE_TARGET_DATABASE_URL}`, `${targetEnv.RESTORE_TARGET_DATABASE_URL}\r\n`,
    'postgresql://test@local\nhost:55439/saleshub_restore_test',
    'postgresql://test@127.0.0.1:55439/saleshub_restore_test?host=prod.example.test',
    'postgresql://test@127.0.0.1:55439/saleshub_restore_test?hostaddr=127.0.0.1',
    'postgresql://test@127.0.0.1:55439/saleshub_restore_test?dbname=production',
    'postgresql://test@127.0.0.1:55439/saleshub_restore_test?service=production',
    'postgresql://test@127.0.0.1:55439/saleshub_restore_test?options=-c%20read_only=off',
    'postgresql://test@127.0.0.1:55439/saleshub_restore_test?sslmode=disable&sslmode=require',
    'postgresql://test@127.0.0.1:55439/saleshub_restore_test?%68ost=production',
    'host=127.0.0.1 port=55439 dbname=saleshub_restore_test user=test',
    'postgresql://test@%2ftmp/saleshub_restore_test', 'postgresql://test@127.0.0.1:0/saleshub_restore_test',
  ];
  for (const value of malformed) {
    assert.throws(() => restoreTarget({ ...targetEnv, RESTORE_TARGET_DATABASE_URL: value }), error => error.stage === 'configuration' && error.message === 'Recovery operation failed');
    assert.throws(() => restoreTarget({ ...targetEnv, RESTORE_PRODUCTION_DATABASE_URL: value }));
  }
  for (const host of ['PROD.EXAMPLE.TEST.', '%70rod.example.test', 'production-alias.example.test', '203.0.113.1', '0xcb007101', '[2001:db8::1]']) {
    assert.throws(() => restoreTarget({ ...targetEnv, RESTORE_TARGET_DATABASE_URL: `postgresql://test@${host}:55439/saleshub_restore_test` }), { stage: 'target-guard' });
  }
  for (const port of ['', ':5432', ':05432']) {
    assert.throws(() => restoreTarget({ ...targetEnv, RESTORE_TARGET_DATABASE_URL: `postgresql://test@localhost${port}/saleshub_restore_test` }), { stage: 'target-guard' });
  }
  assert.throws(() => restoreTarget({ ...targetEnv, RESTORE_CONFIRM: ' restore-disposable-database' }));
  assert.throws(() => restoreTarget({ ...targetEnv, RESTORE_MODE: 'clean', RESTORE_ALLOW_CLEAN: 'replace-disposable-objects ' }));
});

test('environment labels, object keys and version metadata cannot echo arbitrary config/command text', async t => {
  const c = await context(t);
  for (const value of ['review-secret-placeholder', 'Customer_Account_123', env.BACKUP_SPACES_ACCESS_KEY_ID]) {
    assert.throws(() => backupConfig({ ...env, BACKUP_ENVIRONMENT: value }));
    assert.throws(() => backupKeys(value, new Date(), runId));
    assert.throws(() => restoreKey(key.replace('saleshub-prod-', `saleshub-${value}-`)));
  }
  const pg = async (cmd, args, options) => args[0] === '--version' ? 'pg_dump (PostgreSQL) 17.11 (vendor-string-review-secret-placeholder)' : c.pg(cmd, args, options);
  const b = await backup(c.env, { store: c.store, runPg: pg, log: c.log });
  assert.equal(c.objects.get(b.objectKey).metadata['pg-dump-version'], '17.11');
  assert.doesNotMatch(JSON.stringify(c.objects.get(b.objectKey).metadata), /review-secret-placeholder/);
  c.log('backup.completed', { objectKey: key.replace('saleshub-prod-', 'saleshub-review-secret-placeholder-') });
  assert.equal(c.lines.at(-1).objectKey, undefined);
});

test('partial retention-tier uploads fail the whole backup without success and remove private local files', async t => {
  const c = await context(t); const originalPut = c.store.put;
  c.store.put = async (objectKey, file, size, metadata) => {
    assert.equal((await stat(dirname(file))).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    if (objectKey.includes('/weekly/')) throw new Error('review-secret-placeholder');
    return originalPut(objectKey, file, size, metadata);
  };
  await assert.rejects(backup(c.env, { store: c.store, runPg: c.pg, log: c.log, now: new Date('2026-11-01T02:00:00Z') }), { stage: 'spaces-upload' });
  assert.equal(c.objects.size, 1);
  assert.deepEqual(c.lines.map(x => x.event), ['backup.started', 'backup.failed']);
  assert.deepEqual(await readdir(c.root), []);
});

test('subprocess errors do not expose argv, credentials or raw spawn exception properties', async t => {
  const c = await context(t); const previous = process.env.PATH;
  process.env.PATH = c.root; t.after(() => { process.env.PATH = previous; });
  await assert.rejects(runPg('pg_dump', ['--command', 'review-secret-placeholder'], { capture: true }), error => {
    assert.equal(error.message, 'Recovery operation failed');
    assert.equal(error.stage, 'command');
    assert.equal(error.spawnargs, undefined);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(JSON.stringify(error), /review-secret-placeholder/);
    return true;
  });
});

test('SIGTERM during a CLI dump produces failure, hides child diagnostics, removes dump and runtime CA', { timeout: 15_000 }, async t => {
  const c = await context(t); const bin = join(c.root, 'pg_dump');
  await writeFile(bin, `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('pg_dump (PostgreSQL) 17.11');}else{process.stderr.write('review-secret-placeholder');process.stdout.write('PGDMP fixture');setInterval(()=>{},1000);}\n`);
  await chmod(bin, 0o700);
  const child = spawn(process.execPath, ['scripts/operations/backup-postgres.mjs'], {
    cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...c.env, BACKUP_PG_CA_PEM: 'review-private-ca-placeholder', PATH: c.root },
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let dumpExists = false;
  for (let i = 0; i < 200; i++) {
    const folders = (await readdir(c.root)).filter(name => name.startsWith('saleshub-recovery-'));
    if (folders.length) {
      try { dumpExists = (await stat(join(c.root, folders[0], 'database.dump'))).size > 0; } catch { /* Wait for exclusive output file creation. */ }
    }
    if (dumpExists) break;
    await delay(20);
  }
  assert.equal(dumpExists, true, 'dump subprocess never started');
  child.kill('SIGTERM');
  const result = await ended;
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  const events = output.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(x => x.event), ['backup.started', 'backup.failed']);
  assert.equal(events[1].stage, 'interrupted');
  assert.doesNotMatch(output, /review-secret-placeholder|review-private-ca-placeholder|secret-key|postgresql:/);
  assert.deepEqual(await readdir(c.root), ['pg_dump']);
});

test('debug-enabled operational runtimes fail before child or HTTP diagnostics can expose secrets', () => {
  for (const name of ['NODE_DEBUG', 'NODE_DEBUG_NATIVE']) {
    for (const value of ['child_process', 'http,net,tls', '*']) {
      assert.throws(() => backupConfig({ ...env, [name]: value }), { stage: 'configuration' });
      assert.throws(() => restoreTarget({ ...targetEnv, [name]: value }), { stage: 'configuration' });
    }
  }
  const script = `import {runPg,connection} from './scripts/operations/recovery-common.mjs';try{await runPg('psql',[],{c:connection('postgresql://fixture:review-secret-placeholder@127.0.0.1:1/fixture')});process.exitCode=2;}catch(error){console.log(JSON.stringify({stage:error.stage,message:error.message}));process.exitCode=1;}`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 3000,
    env: { PATH: '/nonexistent', NODE_DEBUG: 'child_process' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).stage, 'configuration');
  assert.doesNotMatch(result.stdout + result.stderr, /review-secret-placeholder|PGPASSWORD/);
});

test('missing PostgreSQL tools fail the CLI promptly instead of keeping a 25-minute spawn timer alive', async t => {
  const c = await context(t);
  const result = spawnSync(process.execPath, ['scripts/operations/backup-postgres.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 3000,
    env: { ...c.env, PATH: c.root },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const events = (result.stdout + result.stderr).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(x => x.event), ['backup.started', 'backup.failed']);
  assert.equal(events[1].stage, 'pg-dump');
  assert.deepEqual(await readdir(c.root), []);
});

test('drill pins local Docker, strips host secrets/context, sanitizes child output and only removes its own container', async t => {
  const c = await context(t); const records = join(c.root, 'docker-records.jsonl');
  const docker = join(c.root, 'docker');
  await writeFile(docker, `#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(records)},JSON.stringify({args,hasDb:!!process.env.DATABASE_URL,hasSpaces:!!process.env.BACKUP_SPACES_SECRET_ACCESS_KEY,hasHost:!!process.env.DOCKER_HOST,hasContext:!!process.env.DOCKER_CONTEXT})+'\\n');if(args.includes('run'))console.log('synthetic-container-id');else if(args.includes('exec')&&args.includes('node')){console.log(JSON.stringify({event:'backup.failed',runId:'${runId}',stage:'spaces-upload',DATABASE_URL:'review-secret-placeholder',message:'review-secret-placeholder'}));console.error('    at review-secret-placeholder (/app/scripts/operations/restore-drill-fixture.mjs:99:1)');process.exitCode=1;}\n`);
  await chmod(docker, 0o700);
  const result = spawnSync(process.execPath, ['scripts/operations/restore-drill.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 5000,
    env: { PATH: c.root, DATABASE_URL: 'review-secret-placeholder', BACKUP_SPACES_SECRET_ACCESS_KEY: 'review-secret-placeholder', DOCKER_HOST: 'tcp://prod.example.invalid:2376', DOCKER_CONTEXT: 'production' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /review-secret-placeholder|DATABASE_URL/);
  const calls = (await readFile(records, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.every(call => call.args[0] === '--host' && call.args[1] === 'unix:///var/run/docker.sock'));
  assert.ok(calls.every(call => !call.hasDb && !call.hasSpaces && !call.hasHost && !call.hasContext));
  const run = calls.find(call => call.args.includes('run'));
  const name = run.args[run.args.indexOf('--name') + 1];
  assert.match(name, /^saleshub-restore-drill-[0-9a-f-]{36}$/);
  assert.equal(run.args[run.args.indexOf('--network') + 1], 'none');
  const removed = calls.filter(call => call.args.includes('rm'));
  assert.equal(removed.length, 1);
  assert.equal(removed[0].args.at(-1), name);
});

test('SDK rejection messages and nested payloads are never exposed by storage operations', async t => {
  const c = await context(t); const file = join(c.root, 'fixture.dump'); await writeFile(file, 'fixture');
  const store = spacesStore(spacesConfig(env), undefined, {
    async send() { throw Object.assign(new Error('review-secret-placeholder'), { request: { Authorization: 'review-secret-placeholder' } }); },
    destroy() {},
  });
  for (const action of [() => store.put(key, file, 7, {}), () => store.head(key), () => store.get(key)]) {
    await assert.rejects(action(), error => {
      assert.equal(error.message, 'Recovery operation failed');
      assert.equal(error.stage, 'command');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(JSON.stringify(error), /review-secret-placeholder|Authorization/);
      return true;
    });
  }
});

test('early local upload-stream errors abort the request and allow backup temp/CA cleanup', { timeout: 5000 }, async t => {
  const c = await context(t); let aborted = false;
  const store = spacesStore(spacesConfig(env), undefined, {
    async send(command, { abortSignal }) {
      return new Promise((_, reject) => abortSignal.addEventListener('abort', () => {
        aborted = true; reject(new Error('review-secret-placeholder'));
      }, { once: true }));
    },
    destroy() {},
  });
  c.store.put = async (objectKey, file, size, metadata) => {
    await rm(file); // Simulate loss/read failure between checksum and SDK consumption.
    return store.put(objectKey, file, size, metadata);
  };
  await assert.rejects(backup({ ...c.env, BACKUP_PG_CA_PEM: 'review-private-ca-placeholder' }, { store: c.store, runPg: c.pg, log: c.log }), { stage: 'temp' });
  assert.equal(aborted, true);
  assert.deepEqual(c.lines.map(x => x.event), ['backup.started', 'backup.failed']);
  assert.doesNotMatch(JSON.stringify(c.lines), /review-secret-placeholder|review-private-ca-placeholder/);
  assert.deepEqual(await readdir(c.root), []);
});
