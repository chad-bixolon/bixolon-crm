// Operational-only helpers. No application imports, dotenv loading, or DB writes.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, statfs } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export class RecoveryError extends Error {
  constructor(stage) { super('Recovery operation failed'); this.stage = stage; }
}
const environments = ['prod', 'staging', 'dev', 'test', 'drill'];
export const backupObjectKeyPattern = new RegExp(`^postgres/(daily|weekly|monthly)/saleshub-(${environments.join('|')})-\\d{4}-\\d\\d-\\d\\dT\\d{6}Z-[0-9a-f-]{36}\\.dump$`);
export function assertPrivateRuntime(env = process.env) {
  // Node's child_process/http debug output can print full environment/options
  // before our stderr suppression or logger redaction gets a chance to run.
  for (const key of ['NODE_DEBUG', 'NODE_DEBUG_NATIVE']) {
    if (env[key]?.trim() || process.env[key]?.trim()) throw new RecoveryError('configuration');
  }
}
export function requireValue(env, key) {
  if (typeof env[key] !== 'string' || !env[key].trim()) throw new RecoveryError('configuration');
  return env[key];
}
export function label(value) {
  // Code-owned environment labels cannot accidentally echo a customer name or key.
  if (!environments.includes(value)) throw new RecoveryError('configuration');
  return value;
}
export function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RecoveryError('configuration');
  return n;
}
export function connection(value) {
  try {
    // WHATWG URL silently strips some whitespace/control characters. Do not
    // silently discard characters from credential-bearing operator input.
    if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value) || value.trim() !== value) throw 0;
    const u = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname || u.hash) throw 0;
    const database = decodeURIComponent(u.pathname.slice(1));
    // PGDATABASE can itself be interpreted as conninfo: exclude =, spaces and URI syntax.
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(database)) throw 0;
    const user = decodeURIComponent(u.username);
    const password = decodeURIComponent(u.password);
    if (!user || /[\x00-\x1f\x7f]/.test(user + password)) throw 0;
    const accepted = new Set(['sslmode', 'sslrootcert', 'connection_limit', 'pool_timeout', 'schema']);
    for (const key of u.searchParams.keys()) if (!accepted.has(key) || u.searchParams.getAll(key).length !== 1) throw 0;
    const sslmode = u.searchParams.get('sslmode') || 'verify-full';
    if (!['disable', 'require', 'verify-ca', 'verify-full'].includes(sslmode)) throw 0;
    // PostgreSQL is a non-special WHATWG scheme. Normalize its host separately
    // with the special-host parser (encoded DNS, integer/octal IPv4, IPv6).
    if (!/^[a-zA-Z0-9.%:[\]-]+$/.test(u.hostname)) throw 0;
    const host = new URL(`http://${u.host}`).hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (!/^[a-z0-9.:-]+$/.test(host)) throw 0;
    const rootcert = u.searchParams.get('sslrootcert');
    if (rootcert && (!isAbsolute(rootcert) || /[\x00-\x1f]/.test(rootcert))) throw 0;
    const port = String(Number(u.port || '5432'));
    if (Number(port) < 1 || Number(port) > 65535) throw 0;
    return { host, port, database, user, password, sslmode, rootcert };
  } catch { throw new RecoveryError('configuration'); }
}
export function loopbackHost(host) {
  // Treat both loopback families and wildcard bind addresses as one protected
  // identity. Restore connections themselves permit only 127.0.0.1 and ::1.
  return host === 'localhost' || host.startsWith('localhost.') || host.endsWith('.localhost')
    || ['ip6-localhost', 'ip6-loopback', '::1', '::', '0.0.0.0'].includes(host)
    || /^127\./.test(host) || /^::ffff:(7f[0-9a-f]{2}:|0:0$)/.test(host);
}
export function pgEnvironment(c, readOnly = false) {
  // Do not inherit PGSERVICE, PGOPTIONS, DATABASE_URL, AWS credentials or other secrets.
  return {
    PATH: process.env.PATH, LANG: 'C.UTF-8', PGHOST: c.host, PGPORT: c.port,
    PGDATABASE: c.database, PGUSER: c.user, PGPASSWORD: c.password,
    PGSSLMODE: c.sslmode, ...(c.rootcert ? { PGSSLROOTCERT: c.rootcert } : {}),
    PGPASSFILE: '/dev/null', PGSERVICEFILE: '/dev/null', PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'saleshub-recovery-v1',
    PGOPTIONS: readOnly ? '-c default_transaction_read_only=on -c statement_timeout=1200000 -c lock_timeout=10000' : '-c statement_timeout=1200000 -c lock_timeout=10000',
  };
}

export async function runPg(command, args, { c, readOnly = false, file, maxBytes, capture = false, signal } = {}) {
  assertPrivateRuntime();
  if (!['pg_dump', 'pg_restore', 'psql'].includes(command)) throw new RecoveryError('configuration');
  const child = spawn(command, args, {
    shell: false, env: c ? pgEnvironment(c, readOnly) : { PATH: process.env.PATH, LANG: 'C.UTF-8' },
    stdio: ['ignore', 'pipe', 'ignore'], killSignal: 'SIGTERM', signal,
  });
  // Node 22 spawn's built-in timeout clears on exit, but a failed spawn emits
  // error/close without exit. Own the timer so a missing tool fails promptly.
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 1_500_000);
  timer.unref();
  let bytes = 0;
  let output = '';
  const ended = new Promise((resolve, reject) => {
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      return code === 0 && !timedOut ? resolve() : reject(new RecoveryError('command'));
    });
  });
  let streamed;
  if (file) {
    const limit = new Transform({ transform(chunk, encoding, done) {
      bytes += chunk.length;
      done(bytes > maxBytes ? new RecoveryError('temp-limit') : null, chunk);
    } });
    streamed = pipeline(child.stdout, limit, createWriteStream(file, { flags: 'wx', mode: 0o600 }))
      .catch(error => { child.kill(); throw error; });
  } else {
    child.stdout.on('data', chunk => {
      if (capture) {
        output += chunk.toString();
        if (output.length > 1_048_576) child.kill();
      }
    });
    streamed = Promise.resolve();
  }
  const results = await Promise.allSettled([ended, streamed]);
  if (results[1].status === 'rejected') {
    const error = results[1].reason;
    if (error instanceof RecoveryError) throw error;
    if (['ENOSPC', 'EACCES', 'EROFS', 'EDQUOT', 'EIO'].includes(error?.code)) throw new RecoveryError('temp');
  }
  const failure = results.find(result => result.status === 'rejected');
  // Spawn/stream errors can carry argv, SQL or paths. Keep them internal even
  // when this helper is called directly by the isolated drill/validator.
  if (failure) throw new RecoveryError(signal?.aborted ? 'interrupted' : 'command');
  if (output.length > 1_048_576) throw new RecoveryError('command');
  return output.trim();
}

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function checksum(value) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new RecoveryError('checksum');
  return value;
}
export async function temporary(env, maxBytes, action) {
  const root = env.BACKUP_TEMP_DIR || '/tmp';
  if (!isAbsolute(root)) throw new RecoveryError('configuration');
  const space = await statfs(root);
  // One dump only; read-back verification is streamed, never a second local copy.
  if (space.bavail * space.bsize < maxBytes + 268_435_456) throw new RecoveryError('temp-space');
  const dir = await mkdtemp(join(root, 'saleshub-recovery-'));
  try { return await action(dir); }
  finally {
    try { await rm(dir, { recursive: true, force: true }); }
    catch { throw new RecoveryError('cleanup'); }
  }
}

const stages = new Set(['configuration', 'temp', 'temp-space', 'temp-limit', 'pg-dump', 'archive', 'checksum', 'spaces-upload', 'spaces-verification', 'download', 'target-guard', 'target-not-empty', 'restore', 'validation', 'cleanup', 'interrupted', 'unknown']);
// Same envelope as Production Observability v1, with an operational-only allowlist.
// Never pass error messages, provider responses, URLs, object metadata or arbitrary context.
export function recoveryLogger(write = (line, level) => (level === 'error' ? console.error : console.log)(line)) {
  return (event, fields = {}) => {
    if (typeof event !== 'string' || !/^(backup|restore)\.(started|completed|failed)$/.test(event)) return;
    const safe = { timestamp: new Date().toISOString(), level: event.endsWith('.failed') ? 'error' : 'info', event, message: event };
    for (const key of ['runId', 'durationMs', 'objectKey', 'sizeBytes', 'sha256', 'stage']) {
      const value = Object.getOwnPropertyDescriptor(fields, key)?.value;
      if (key === 'runId' && typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)) safe[key] = value;
      if (['durationMs', 'sizeBytes'].includes(key) && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
      if (key === 'sha256' && typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) safe[key] = value;
      if (key === 'stage' && stages.has(value)) safe[key] = value;
      if (key === 'objectKey' && typeof value === 'string' && backupObjectKeyPattern.test(value)) safe[key] = value;
    }
    write(JSON.stringify(safe), safe.level);
  };
}
export async function lifecycle(kind, action, log = recoveryLogger()) {
  const started = Date.now(); const runId = randomUUID();
  log(`${kind}.started`, { runId });
  try {
    const result = await action(runId);
    log(`${kind}.completed`, { ...result, runId, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    log(`${kind}.failed`, { runId, durationMs: Date.now() - started, stage: stages.has(error?.stage) ? error.stage : 'unknown' });
    throw new RecoveryError(stages.has(error?.stage) ? error.stage : 'unknown');
  }
}
export async function atStage(stage, action) {
  try { return await action(); }
  catch (error) { throw new RecoveryError(error instanceof RecoveryError && stages.has(error.stage) ? error.stage : stage); }
}
export function signalController() {
  const controller = new AbortController();
  const stop = () => controller.abort(new RecoveryError('interrupted'));
  const timer = setTimeout(stop, 1_500_000);
  timer.unref();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  return { signal: controller.signal, close() { clearTimeout(timer); process.off('SIGTERM', stop); process.off('SIGINT', stop); } };
}
