import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { RecoveryError, assertPrivateRuntime, atStage, backupObjectKeyPattern, checksum, connection, lifecycle, loopbackHost, requireValue, runPg, sha256, signalController, temporary } from './recovery-common.mjs';
import { spacesConfig, spacesStore } from './backup-spaces.mjs';

export function restoreTarget(env) {
  assertPrivateRuntime(env);
  const target = connection(requireValue(env, 'RESTORE_TARGET_DATABASE_URL'));
  // Passwordless production identity is sufficient; do not give the restore job production credentials.
  const production = connection(requireValue(env, 'RESTORE_PRODUCTION_DATABASE_URL'));
  const protectedConnections = [production, ...['DATABASE_URL', 'BACKUP_DATABASE_URL'].filter(key => env[key]).map(key => connection(env[key]))];
  const sameHost = (a, b) => a === b || (loopbackHost(a) && loopbackHost(b));
  if (loopbackHost(production.host) || sameHost(target.host, production.host)
      || protectedConnections.some(c => sameHost(c.host, target.host) && c.port === target.port && c.database === target.database)
      || !['127.0.0.1', 'localhost', '::1'].includes(target.host) || target.port === '5432'
      || !/^saleshub_restore_[a-z0-9_]+$/.test(target.database)
      || env.RESTORE_CONFIRM !== 'restore-disposable-database'
      || !['empty', 'clean'].includes(env.RESTORE_MODE || 'empty')) throw new RecoveryError('target-guard');
  if (env.RESTORE_MODE === 'clean' && env.RESTORE_ALLOW_CLEAN !== 'replace-disposable-objects') throw new RecoveryError('target-guard');
  // Never perform a DNS lookup for an allowed localhost target. A poisoned hosts
  // entry must not be able to redirect this restore to a remote PostgreSQL host.
  return { ...target, host: target.host === 'localhost' ? '127.0.0.1' : target.host };
}
export function restoreKey(key) {
  if (!backupObjectKeyPattern.test(key || '')) throw new RecoveryError('configuration');
  return key;
}
export async function download(store, key, file, maxBytes, expected, signal) {
  const head = await store.head(key);
  if (!Number.isSafeInteger(head.size) || head.size < 1 || head.size > maxBytes) throw new RecoveryError('archive');
  if (checksum(head.metadata?.sha256) !== expected) throw new RecoveryError('checksum');
  const body = await store.get(key); let bytes = 0;
  const limit = new Transform({ transform(chunk, encoding, done) {
    bytes += chunk.length;
    done(bytes > head.size ? new RecoveryError('checksum') : null, chunk);
  } });
  try { await pipeline(body, limit, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal }); }
  finally { body.destroy?.(); }
  if ((await stat(file)).size !== head.size || await sha256(file) !== expected) throw new RecoveryError('checksum');
  return head.size;
}

const psqlArgs = sql => ['--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', sql];
export const emptyTargetSql = `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f')`;
export async function restore(env = process.env, deps = {}) {
  return lifecycle('restore', async () => {
    const target = restoreTarget(env);
    const config = spacesConfig(env);
    const key = restoreKey(requireValue(env, 'RESTORE_OBJECT_KEY'));
    const expected = checksum(requireValue(env, 'RESTORE_EXPECTED_SHA256'));
    const store = deps.store || spacesStore(config, deps.signal);
    const pg = deps.runPg || runPg;
    try {
      return await atStage('temp', () => temporary(env, config.maxBytes, async dir => {
        const file = join(dir, 'restore.dump');
        const size = await atStage('download', () => download(store, key, file, config.maxBytes, expected, deps.signal));
        await atStage('archive', () => pg('pg_restore', ['--list', file], { signal: deps.signal }));
        if ((env.RESTORE_MODE || 'empty') === 'empty') {
          const objects = await atStage('validation', () => pg('psql', psqlArgs(emptyTargetSql), { c: target, capture: true, signal: deps.signal }));
          if (objects !== '0') throw new RecoveryError('target-not-empty');
        }
        const args = ['--no-password', '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'];
        if (env.RESTORE_MODE === 'clean') args.push('--clean', '--if-exists');
        // No --create, DROP DATABASE, or credentials on the command line.
        args.push('--dbname', target.database, file);
        await atStage('restore', () => pg('pg_restore', args, { c: target, signal: deps.signal }));
        return { objectKey: key, sizeBytes: size, sha256: expected };
      }));
    } finally { if (!deps.store) store.close(); }
  }, deps.log);
}

export const validationSql = `SELECT json_build_object(
  'User', (SELECT count(*) FROM public."User"),
  'Account', (SELECT count(*) FROM public."Account"),
  'Opportunity', (SELECT count(*) FROM public."Opportunity"),
  'Project', (SELECT count(*) FROM public."Project"),
  'PriceException', (SELECT count(*) FROM public."PriceException"),
  'latestMigration', (SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1),
  'unfinishedMigrations', (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL)
)`;
export async function validateRestored(env = process.env, pg = runPg) {
  const c = restoreTarget(env);
  return atStage('validation', async () => {
    const result = JSON.parse(await pg('psql', psqlArgs(validationSql), { c, readOnly: true, capture: true }));
    const supportExists = await pg('psql', psqlArgs(`SELECT to_regclass('public."SupportCase"') IS NOT NULL`), { c, readOnly: true, capture: true });
    if (!['t', 'f'].includes(supportExists)) throw new RecoveryError('validation');
    if (supportExists === 't') result.SupportCase = Number(await pg('psql', psqlArgs('SELECT count(*) FROM public."SupportCase"'), { c, readOnly: true, capture: true }));
    for (const key of ['User', 'Account', 'Opportunity', 'Project', 'PriceException', 'unfinishedMigrations', ...(supportExists === 't' ? ['SupportCase'] : [])]) {
      if (!Number.isSafeInteger(result[key]) || result[key] < 0) throw new RecoveryError('validation');
    }
    if (result.unfinishedMigrations !== 0 || !/^[0-9]{12,14}_[a-z0-9_]+$/.test(result.latestMigration || '')) throw new RecoveryError('validation');
    return result;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const signals = signalController();
  try { await restore(process.env, { signal: signals.signal }); }
  catch { process.exitCode = 1; }
  finally { signals.close(); }
}
