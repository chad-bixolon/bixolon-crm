// Host harness: no host DB URLs, no published ports, no existing DB volumes.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { assertPrivateRuntime, recoveryLogger } from './recovery-common.mjs';

const name = `saleshub-restore-drill-${randomUUID()}`;
const scripts = dirname(fileURLToPath(import.meta.url));
const docker = args => execFileSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
  // Neither a remote DOCKER_HOST/context nor host DB/cloud secrets may reach
  // the drill's Docker client. The container receives only fixed fixture values.
  env: { PATH: process.env.PATH }, encoding: 'utf8', stdio: 'pipe', timeout: 300_000,
});
const startup = `openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout /tmp/drill-key.pem -out /tmp/drill-cert.pem >/dev/null 2>&1 && chown postgres:postgres /tmp/drill-key.pem /tmp/drill-cert.pem && chmod 600 /tmp/drill-key.pem && exec docker-entrypoint.sh postgres -p 55439 -c ssl=on -c ssl_cert_file=/tmp/drill-cert.pem -c ssl_key_file=/tmp/drill-key.pem`;
let created = false;
try {
  assertPrivateRuntime();
  docker(['run', '-d', '--name', name, '--network', 'none', '--memory', '1g', '--cpus', '2',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '--tmpfs', '/tmp:rw,size=384m,mode=1777',
    '--mount', `type=bind,src=${resolve(scripts)},dst=/app/scripts/operations,readonly`,
    '-e', 'POSTGRES_PASSWORD=drill_only', '-e', 'SALESHUB_DISPOSABLE_DRILL=fixture-only',
    '--user', 'root', '--entrypoint', '/bin/sh', 'saleshub-recovery-ops:local', '-c', startup]);
  created = true;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-p', '55439', '-U', 'postgres']); ready = true; break; }
    catch { await setTimeout(250); }
  }
  if (!ready) throw Error('Disposable PostgreSQL did not become ready');
  process.stdout.write(docker(['exec', '--user', 'postgres', '--workdir', '/app', name, 'node', 'scripts/operations/restore-drill-fixture.mjs']));
} catch (error) {
  // Only code locations and our known structured events, never raw child messages/SQL.
  for (const line of `${error.stdout || ''}\n${error.stderr || ''}`.split('\n')) {
    const frame = /restore-drill-fixture\.mjs:(\d+):(\d+)/.exec(line);
    if (/^\s+at /.test(line) && frame) console.error(`at restore-drill-fixture.mjs:${frame[1]}:${frame[2]}`);
    try {
      const event = JSON.parse(line);
      if (event.event === 'drill.failed') {
        console.error(JSON.stringify({ event: 'drill.failed', ...(/^restore-drill-fixture\.mjs:\d+:\d+$/.test(event.location) ? { location: event.location } : {}) }));
      } else recoveryLogger(line => console.error(line))(event.event, event);
    } catch { /* Child diagnostics may contain credentials: discard them. */ }
  }
  console.error('Disposable restore drill failed; no production resources were used.');
  process.exitCode = 1;
} finally {
  if (created) {
    try { docker(['rm', '--force', '--volumes', name]); }
    catch { console.error('Disposable drill container cleanup failed.'); process.exitCode = 1; }
  }
}
