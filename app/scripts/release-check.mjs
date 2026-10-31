import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
export const operationalReminders = [
  'External deployment/provider state is NOT VERIFIED by this check.',
  'Runtime: DATABASE_URL, AUTH_URL, AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, GOOGLE_WORKSPACE_DOMAIN; private Spaces settings. See docs/deployment.md and docs/authentication.md.',
  'Weekly Snapshot Job: Monday 05:00 America/New_York; WEEKLY_SNAPSHOT_SECRET, SALESHUB_JOB_ORIGIN. See ../docs/weekly-snapshot-automation.md.',
  'Daily notifications: NOTIFICATION_EVALUATOR_SECRET; Calendar polling (suggested every 15 minutes): CALENDAR_SYNC_SECRET, CALENDAR_TOKEN_ENCRYPTION_KEY. Verify recent System Health evidence; see docs/notification-center.md and docs/google-calendar-connection.md.',
  'Support Gmail: verify production OAuth, mailbox, encryption key, Spaces and feature flags per docs/support-email-rollout.md. No live provider requests are made.',
];

export function parseOptions(args) {
  const options = { base: 'HEAD^', allowDirty: false, focus: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow-dirty') options.allowDirty = true;
    else if (['--base', '--focus'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('-')) options[args[i].slice(2)] = args[++i];
    else throw new Error('Usage: npm run release:check -- [--base <deployed-commit>] [--allow-dirty] [--focus support|snapshots]');
  }
  if (options.focus && !['support', 'snapshots'].includes(options.focus)) throw new Error('Focus must be support or snapshots.');
  return options;
}

export function runtimeSupported(version, range) {
  // Fail closed if the project switches to a range syntax this small checker does not support.
  const expected = /^>=(\d+)\.(\d+)(?:\.(\d+))? <(\d+)$/.exec(range);
  const actual = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!expected || !actual) return false;
  const [, major, minor, patch = '0', upper] = expected;
  const minimum = [major, minor, patch].map(Number);
  const current = actual.slice(1).map(Number);
  const atLeastMinimum = current.every((value, index) => value === minimum[index]) ||
    current.some((value, index) => value > minimum[index] && current.slice(0, index).every((part, at) => part === minimum[at]));
  return current[0] < Number(upper) && atLeastMinimum;
}

export function assertNpmToolchain(pkg, version) {
  if (pkg.packageManager !== 'npm@12.2.1' || pkg.engines?.npm !== '12.2.1' || version !== '12.2.1') {
    throw new Error(`npm ${version} does not match the pinned npm 12.2.1 toolchain. Select Node 22.23.4 and install npm@12.2.1 using the documented setup.`);
  }
}

export function redact(text, values = []) {
  let result = String(text).replace(/\x1b\[[0-9;]*m/g, '');
  for (const value of [...new Set(values)].filter(value => typeof value === 'string' && value.length >= 4).sort((a, b) => b.length - a.length)) result = result.split(value).join('[REDACTED]');
  return result.replace(/\b(postgres(?:ql)?|https?):\/\/[^\s<>"']+/gi, (url) => {
    try { const parsed = new URL(url); return parsed.username || parsed.password || parsed.search ? `${parsed.protocol}//[REDACTED]` : url; } catch { return '[REDACTED URL]'; }
  }).replace(/((?:password|secret|token|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

export function parseUnitCounts(output) {
  const number = name => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(output)?.[1] ?? NaN);
  return { passed: number('pass'), failed: number('fail'), skipped: number('skipped'), total: number('tests') };
}

export function migrationChanged(paths) {
  return paths.some(path => path === 'app/prisma/schema.prisma' || path === 'app/prisma.config.ts' || path.startsWith('app/prisma/migrations/') || path.startsWith('app/prisma/tests/') || ['app/scripts/test-migrations.py', 'app/scripts/prisma-generate.mjs', 'app/Dockerfile', 'app/.dockerignore', 'app/.npmrc', 'app/package.json', 'app/package-lock.json', '.github/workflows/ci.yml'].includes(path));
}

function safeEnvironment(temp) {
  // Do not give subprocesses inherited production credentials. dotenv/Next cannot override these guards.
  const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'SystemRoot', 'COMSPEC', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  return { ...env, TMPDIR: temp, TMP: temp, TEMP: temp, CI: '1', NEXT_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1', NODE_DISABLE_COMPILE_CACHE: '1',
    DATABASE_URL: 'postgresql://validation:validation@127.0.0.1:1/validation', AUTH_SECRET: 'release-validation-local-only-secret', AUTH_URL: 'http://127.0.0.1:3100',
    AUTH_GOOGLE_ID: 'unused-release-validation', AUTH_GOOGLE_SECRET: 'unused-release-validation',
    SUPPORT_GMAIL_ENABLED: 'false', SUPPORT_GMAIL_MOCK: 'true', SUPPORT_GMAIL_TEST_FIXTURE: 'false', E2E_AUTH_ENABLED: 'false', E2E_STORAGE_ENABLED: 'false', ENABLE_DEV_IMPERSONATION: 'false',
  };
}

function secretValues() {
  const values = { ...process.env };
  for (const directory of [resolve(app, '..'), app]) for (const name of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local']) {
    const path = resolve(directory, name);
    if (existsSync(path)) Object.assign(values, Object.fromEntries(Object.entries(require('dotenv').parse(readFileSync(path))).map(([key, value]) => [`${path}:${key}`, value])));
  }
  return Object.entries(values).filter(([key]) => /secret|password|token|credential|key|database_url/i.test(key)).map(([, value]) => value);
}

export function commandRunner(env, clean) {
  return (command, args, logPath, overrides = {}) => new Promise((done) => {
    let output = '';
    if (logPath) writeFileSync(logPath, '', { mode: 0o600 });
    const child = spawn(command, args, { cwd: app, env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      const reader = createInterface({ input: stream });
      reader.on('line', line => {
        const safe = clean(line);
        output = (output + safe + '\n').slice(-2_000_000);
        if (logPath) appendFileSync(logPath, safe + '\n');
      });
    }
    const stop = signal => child.kill(signal);
    const interrupt = () => stop('SIGINT');
    const terminate = () => stop('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    child.on('error', error => { output += clean(error.message); if (logPath) appendFileSync(logPath, clean(error.message) + '\n'); });
    child.on('close', (code, signal) => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
      if (signal) { output += `Command stopped by ${signal}`; if (logPath) appendFileSync(logPath, `Command stopped by ${signal}\n`); }
      done({ code: code ?? 1, output });
    });
  });
}

async function repository(run, base) {
  const git = async args => { const result = await run('git', args); if (result.code) throw new Error(`Git inspection failed: ${args[0]}. Check the baseline exists locally.`); return result.output.trim(); };
  const commit = await git(['rev-parse', 'HEAD']);
  const branch = await git(['branch', '--show-current']) || '(detached HEAD)';
  const baseline = await git(['rev-parse', '--verify', `${base}^{commit}`]);
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all']);
  const changed = await git(['diff', '--name-only', '--no-renames', baseline, '--', ':/']);
  const untracked = await git(['ls-files', '--others', '--exclude-standard', '--full-name', '--', ':/']);
  const files = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--full-name', '--', ':/']);
  const digest = createHash('sha256');
  for (const path of [...new Set(files.split('\0').filter(Boolean))].sort()) {
    digest.update(path + '\0');
    const absolute = resolve(app, '..', path);
    digest.update(existsSync(absolute) ? readFileSync(absolute) : '[deleted]');
    digest.update('\0');
  }
  return { commit, branch, baseline, baselineRef: base, contentSha256: digest.digest('hex'), dirty: Boolean(status), trackedModified: status.split('\n').some(line => line && !line.startsWith('??')), untracked: Boolean(untracked), status,
    changedPaths: [...new Set([...changed.split('\n'), ...untracked.split('\n')].filter(Boolean))] };
}

export function renderSummary(evidence) {
  return ['SalesHub Release Check', `Timestamp: ${evidence.timestamp}`, `Commit: ${evidence.repository?.commit ?? 'unknown'}`, `Branch: ${evidence.repository?.branch ?? 'unknown'}`, `Baseline: ${evidence.repository?.baseline ?? evidence.options.base}`, `Working tree: ${evidence.repository?.dirty ? 'DIRTY (not release-ready)' : evidence.repository ? 'clean' : 'unknown'}`, `Node: ${evidence.runtime.node}; npm: ${evidence.runtime.npm ?? 'not checked'}`,
    ...evidence.stages.map(stage => `${stage.name}: ${stage.status}${stage.detail ? ` — ${stage.detail}` : ''} (${stage.durationMs}ms)`),
    `Cleanup: ${evidence.cleanup.join('; ') || 'none'}`, ...operationalReminders, `Result: ${evidence.result === 'READY' ? 'READY FOR RELEASE (local code validation; external verification still required)' : 'NOT READY'}`, ''].join('\n');
}

// Dependency injection lets orchestration tests exercise failures without recursively running the suite.
export async function runReleaseCheck(options, dependencies = {}) {
  const timestamp = new Date().toISOString();
  const directory = dependencies.directory ?? resolve(app, 'reports/release', `${timestamp.replace(/[:.]/g, '-')}-${process.pid}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = resolve(directory, 'temporary'); mkdirSync(temp, { mode: 0o700 });
  const secrets = dependencies.clean ? [] : secretValues();
  const clean = dependencies.clean ?? (value => redact(value, secrets));
  const run = dependencies.run ?? commandRunner(safeEnvironment(temp), clean);
  const evidence = { formatVersion: 1, timestamp, options, repository: null, runtime: { node: dependencies.nodeVersion ?? process.version }, stages: [], cleanup: [], operationalReminders, result: 'NOT READY', directory };
  const stages = ['Repository', 'Runtime', 'Prisma client', 'Lint', 'TypeScript', 'Unit', 'Migrations', 'Focused tests', 'Browser smoke', 'Production build', 'Final repository'];
  const generated = ['next-env.d.ts', 'tsconfig.json', 'AGENTS.md', 'CLAUDE.md'];
  let snapshot;
  async function stage(name, action) {
    const start = Date.now();
    const record = { name, status: 'FAIL', durationMs: 0 };
    evidence.stages.push(record);
    try { const detail = await action(); Object.assign(record, { status: 'PASS', ...detail }); }
    catch (error) { record.detail = clean(error.message); if (error.counts) record.counts = error.counts; throw error; }
    finally { record.durationMs = Date.now() - start; writeFileSync(resolve(directory, 'release.json'), clean(JSON.stringify(evidence, null, 2)) + '\n', { mode: 0o600 }); dependencies.report?.(`${name}: ${record.status}${record.detail ? ` — ${record.detail}` : ''}`); }
  }
  async function checked(name, command, args, overrides) {
    const log = `${name.toLowerCase().replace(/[^a-z]+/g, '-')}.log`;
    const result = await run(command, args, resolve(directory, log), overrides);
    if (result.code) {
      const error = new Error(`${name} failed (exit ${result.code}). See ${log}.\n${result.output.slice(-3000)}`);
      const counts = name === 'Unit' ? parseUnitCounts(result.output) : null;
      if (counts && Object.values(counts).every(Number.isFinite)) error.counts = counts;
      throw error;
    }
    return result.output;
  }
  try {
    await stage('Repository', async () => {
      evidence.repository = await (dependencies.repository ?? repository)(run, options.base);
      if (evidence.repository.dirty && !options.allowDirty) throw new Error('Working tree is dirty. Commit/review changes first; --allow-dirty runs development validation but cannot produce READY.');
      evidence.storage = (dependencies.checkStorage ?? (() => {
        const capacity = path => { const stats = statfsSync(path); return stats.bavail * stats.bsize; };
        const available = { worktreeAvailableBytes: capacity(app), tempAvailableBytes: capacity(temp) };
        if (Object.values(available).some(bytes => bytes < 1024 ** 3)) throw new Error('Less than 1 GiB free for validation. Review host storage before rerunning; nothing was pruned.');
        return available;
      }))();
      return { detail: evidence.repository.dirty ? 'DIRTY: development validation explicitly allowed' : 'clean' };
    });
    await stage('Runtime', async () => {
      const pkg = dependencies.pkg ?? JSON.parse(readFileSync(resolve(app, 'package.json')));
      evidence.runtime.expectedNode = pkg.engines.node;
      evidence.runtime.pinnedNode = readFileSync(resolve(app, '.nvmrc'), 'utf8').trim();
      evidence.runtime.npm = (await checked('npm version', npm, ['--version'])).trim();
      assertNpmToolchain(pkg, evidence.runtime.npm);
      evidence.runtime.prismaCli = dependencies.prismaVersion ?? require('prisma/package.json').version;
      evidence.runtime.prismaClient = dependencies.prismaVersion ?? require('@prisma/client/package.json').version;
      if (!runtimeSupported(evidence.runtime.node, pkg.engines.node)) throw new Error(`Node ${evidence.runtime.node} is unsupported; expected ${pkg.engines.node} (.nvmrc ${evidence.runtime.pinnedNode}). Select the supported runtime before rerunning.`);
      for (const version of [evidence.runtime.prismaCli, evidence.runtime.prismaClient]) if (version !== pkg.dependencies.prisma || version !== pkg.dependencies['@prisma/client']) throw new Error('Installed Prisma CLI/client must match the pinned package versions. Use the documented dependency setup.');
    });
    await stage('Prisma client', async () => {
      await checked('Prisma generation', npm, ['run', 'prisma:generate']);
      const normalizedSchema = resolve(temp, 'schema.prisma');
      writeFileSync(normalizedSchema, readFileSync(resolve(app, 'prisma/schema.prisma')));
      await checked('Prisma schema normalization', process.execPath, [require.resolve('prisma/build/index.js'), 'format', '--schema', normalizedSchema]);
      return (dependencies.verifyClient ?? verifyClient)(normalizedSchema);
    });
    await stage('Lint', () => checked('Lint', npm, ['run', 'lint']).then(() => ({})));
    await stage('TypeScript', () => checked('TypeScript', npm, ['run', 'typecheck']).then(() => ({})));
    await stage('Unit', async () => {
      // The existing npm test entry point bounds file workers for this host.
      const output = await checked('Unit', npm, ['test']);
      const counts = parseUnitCounts(output);
      if (!Object.values(counts).every(Number.isFinite) || counts.failed || !counts.passed) throw new Error('Unit result counts missing or unsuccessful; see unit.log.');
      return { counts, detail: `${counts.passed} passed / ${counts.failed} failed / ${counts.skipped} skipped` };
    });
    await stage('Migrations', async () => {
      if (!migrationChanged(evidence.repository.changedPaths)) return { status: 'SKIP', detail: 'Migration validation not required for this candidate' };
      // Share the image build and existing migration harness with hosted CI.
      await checked('Migrations', npm, ['run', 'test:migrations']);
      return { detail: 'Existing replay, populated preservation, integrity, rollback and schema-parity suite passed' };
    });
    await stage('Focused tests', async () => {
      if (!options.focus) return { status: 'SKIP', detail: 'No optional focus selected' };
      const files = options.focus === 'support' ? ['support.spec.ts', 'support-case-work.spec.ts'] : ['opportunity-snapshots.spec.ts', 'forecast-snapshots.spec.ts', 'weekly-snapshots.spec.ts'];
      await checked('Focused browser', npm, ['run', 'test:e2e', '--', ...files, '--project=desktop-chromium', '--workers=1', '--retries=0', '--reporter=list', `--output=${resolve(directory, 'focused-browser')}`], { E2E_DATABASE_NAME: 'saleshub_e2e_release' });
    });
    await stage('Browser smoke', async () => {
      const output = await checked('Browser smoke', npm, ['run', 'test:e2e:release-smoke', '--', `--output=${resolve(directory, 'browser')}`], { E2E_DATABASE_NAME: 'saleshub_e2e_release' });
      const passed = Number(/(\d+) passed/.exec(output)?.[1] ?? 0);
      if (!passed || /\d+ (?:failed|skipped)/.test(output)) throw new Error('Browser smoke did not complete all checks; see browser-smoke.log.');
      return { counts: { passed }, detail: `${passed} passed; isolated local E2E database, one worker` };
    });
    await stage('Production build', async () => {
      snapshot = new Map(generated.map(name => [name, existsSync(resolve(app, name)) ? readFileSync(resolve(app, name)) : null]));
      await checked('Production build', npm, ['run', 'build:release']);
      return { detail: 'Webpack (avoids host Turbopack worker-port restrictions)' };
    });
  } catch { /* A failing stage already contains the safe error and log path. */ }
  finally {
    if (snapshot) for (const [name, original] of snapshot) {
      const path = resolve(app, name);
      if (original !== null) writeFileSync(path, original);
      else if (existsSync(path) && ((name === 'AGENTS.md' && readFileSync(path, 'utf8').startsWith('<!-- BEGIN:nextjs-agent-rules -->')) || (name === 'CLAUDE.md' && readFileSync(path, 'utf8').trim() === '@AGENTS.md'))) rmSync(path);
    }
    rmSync(temp, { recursive: true, force: true }); evidence.cleanup.push('Removed run-owned temporary directory (including browser temp/transform caches)');
    const success = evidence.stages.length === stages.length - 1 && evidence.stages.every(item => item.status !== 'FAIL');
    if (success) {
      for (const name of ['browser', 'focused-browser']) rmSync(resolve(directory, name), { recursive: true, force: true });
      evidence.cleanup.push('Removed successful browser artifacts; retained logs/evidence and standard build output');
      await stage('Final repository', async () => {
        const final = await (dependencies.repository ?? repository)(run, options.base);
        evidence.finalRepository = final;
        if (final.commit !== evidence.repository.commit || final.branch !== evidence.repository.branch || final.status !== evidence.repository.status || final.contentSha256 !== evidence.repository.contentSha256) throw new Error('Repository changed during validation. Review changes and rerun.');
        await checked('Diff whitespace', 'git', ['diff', '--check']);
      }).catch(() => {});
      if (evidence.stages.every(item => item.status !== 'FAIL') && !evidence.repository.dirty) evidence.result = 'READY';
    }
    for (const name of stages) if (!evidence.stages.some(item => item.name === name)) evidence.stages.push({ name, status: 'NOT RUN', durationMs: 0 });
    evidence.durationMs = Date.now() - Date.parse(timestamp);
    writeFileSync(resolve(directory, 'release.json'), clean(JSON.stringify(evidence, null, 2)) + '\n', { mode: 0o600 });
    writeFileSync(resolve(directory, 'release.txt'), clean(renderSummary(evidence)), { mode: 0o600 });
  }
  return evidence;
}

export function assertClientAlignment(expected, generated, embedded, installedVersion, generatedVersion) {
  if (expected !== generated || generated !== embedded) throw new Error('Generated Prisma schema/runtime differs from the normalized checked-in schema. Generation/alignment failed.');
  if (generatedVersion !== installedVersion) throw new Error('Generated Prisma runtime version differs from installed client.');
}

export function verifyClient(normalizedSchema) {
  const schema = readFileSync(resolve(app, 'prisma/schema.prisma'));
  const generated = readFileSync(resolve(app, 'node_modules/.prisma/client/schema.prisma'));
  const { Prisma, PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ datasourceUrl: 'postgresql://validation:validation@127.0.0.1:1/validation' });
  try {
    // Prisma 6.19.3 embeds the normalized schema in its generated runtime. Checking
    // that too detects a stale JS client even if the copied schema is current.
    assertClientAlignment(readFileSync(normalizedSchema, 'utf8'), generated.toString(), client._engineConfig.inlineSchema, require('@prisma/client/package.json').version, Prisma.prismaVersion.client);
  } finally { void client.$disconnect(); }
  return { detail: 'Regenerated with existing safe helper; Prisma-normalized schema, embedded runtime schema and version match', schemaSha256: createHash('sha256').update(schema).digest('hex'), generatedClientVersion: Prisma.prismaVersion.client };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lock = resolve(app, 'reports/release/.active');
  let locked = false;
  try {
    const options = parseOptions(process.argv.slice(2));
    mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
    try { mkdirSync(lock, { mode: 0o700 }); locked = true; }
    catch { throw new Error('Another release check may be active (reports/release/.active). Check its owner.json; remove only a confirmed abandoned lock before rerunning.'); }
    writeFileSync(resolve(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    const result = await runReleaseCheck(options, { report: line => process.stdout.write(line + '\n') });
    process.stdout.write(renderSummary(result) + `Evidence: ${result.directory}\n`);
    process.exitCode = result.result === 'READY' ? 0 : 1;
  } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
  finally { if (locked) rmSync(lock, { recursive: true, force: true }); }
}
