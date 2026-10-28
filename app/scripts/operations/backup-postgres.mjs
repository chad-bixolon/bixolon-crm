import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RecoveryError, assertPrivateRuntime, atStage, connection, label, lifecycle, requireValue, runPg, sha256, signalController, temporary } from './recovery-common.mjs';
import { spacesConfig, spacesStore, verifyRemote } from './backup-spaces.mjs';

export function backupConfig(env) {
  assertPrivateRuntime(env);
  const c = connection(requireValue(env, 'BACKUP_DATABASE_URL'));
  if (c.database !== requireValue(env, 'BACKUP_DATABASE_NAME') || c.sslmode !== 'verify-full' || (!c.rootcert && !env.BACKUP_PG_CA_PEM)) throw new RecoveryError('configuration');
  const environment = label(requireValue(env, 'BACKUP_ENVIRONMENT'));
  const gitSha = env.RELEASE_GIT_SHA || 'unknown';
  if (gitSha !== 'unknown' && !/^[a-f0-9]{40}$/.test(gitSha)) throw new RecoveryError('configuration');
  return { c, environment, gitSha, spaces: spacesConfig(env) };
}
export function backupKeys(environment, now, runId) {
  label(environment);
  if (!/^[0-9a-f-]{36}$/.test(runId) || !Number.isFinite(now.getTime())) throw new RecoveryError('configuration');
  const stamp = now.toISOString().replace(/:/g, '').replace(/\.\d{3}Z$/, 'Z');
  const file = `saleshub-${environment}-${stamp}-${runId}.dump`;
  const tiers = ['daily'];
  if (now.getUTCDay() === 0) tiers.push('weekly');
  if (now.getUTCDate() === 1) tiers.push('monthly');
  return tiers.map(tier => `postgres/${tier}/${file}`);
}
export async function backup(env = process.env, deps = {}) {
  return lifecycle('backup', async runId => {
    const config = backupConfig(env);
    const store = deps.store || spacesStore(config.spaces, deps.signal);
    const pg = deps.runPg || runPg;
    const now = deps.now || new Date();
    try {
      return await atStage('temp', () => temporary(env, config.spaces.maxBytes, async dir => {
        const file = join(dir, 'database.dump');
        if (env.BACKUP_PG_CA_PEM) {
          config.c.rootcert = join(dir, 'postgres-ca.crt');
          await writeFile(config.c.rootcert, env.BACKUP_PG_CA_PEM, { flag: 'wx', mode: 0o600 });
        }
        const version = await atStage('pg-dump', () => pg('pg_dump', ['--version'], { capture: true, signal: deps.signal }));
        const match = version.match(/^pg_dump \(PostgreSQL\) (\d+(?:\.\d+)*)(?: [^\r\n]*)?$/);
        if (!match) throw new RecoveryError('pg-dump');
        await atStage('pg-dump', () => pg('pg_dump', ['--format=custom', '--compress=6', '--no-password', '--lock-wait-timeout=10s'],
          { c: config.c, readOnly: true, file, maxBytes: config.spaces.maxBytes, signal: deps.signal }));
        const size = (await stat(file)).size;
        if (!size || size > config.spaces.maxBytes) throw new RecoveryError('archive');
        await atStage('archive', () => pg('pg_restore', ['--list', file], { signal: deps.signal }));
        const digest = await atStage('checksum', () => sha256(file));
        const metadata = { environment: config.environment, database: config.c.database, timestamp: now.toISOString(),
          'git-sha': config.gitSha, 'dump-format': 'custom', 'pg-dump-version': match[1], 'metadata-version': '1', sha256: digest,
        };
        const keys = backupKeys(config.environment, now, runId);
        for (const key of keys) {
          await atStage('spaces-upload', () => store.put(key, file, size, metadata));
          await atStage('spaces-verification', () => verifyRemote(store, key, size, digest));
        }
        return { objectKey: keys[0], sizeBytes: size, sha256: digest };
      }));
    } finally { if (!deps.store) store.close(); }
  }, deps.log);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const signals = signalController();
  try { await backup(process.env, { signal: signals.signal }); }
  catch { process.exitCode = 1; }
  finally { signals.close(); }
}
