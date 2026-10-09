import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const watched = ['next-env.d.ts', 'tsconfig.json', 'AGENTS.md', 'CLAUDE.md'];
const before = new Map(watched.map(name => {
  const path = resolve(name);
  return [path, existsSync(path) ? readFileSync(path, 'utf8') : null];
}));
let child;

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal));

function run(command, args) {
  return new Promise((done, reject) => {
    child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => { child = undefined; done(code ?? 1); });
  });
}

try {
  const prepared = await run(process.execPath, ['e2e/prepare.mjs']);
  process.exitCode = prepared || await run('./node_modules/.bin/playwright', ['test', ...process.argv.slice(2)]);
} finally {
  for (const [path, original] of before) {
    if (original !== null) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== original) writeFileSync(path, original);
      continue;
    }
    if (!existsSync(path)) continue;
    const generated = readFileSync(path, 'utf8');
    if (path.endsWith('/AGENTS.md') && generated.startsWith('<!-- BEGIN:nextjs-agent-rules -->') || path.endsWith('/CLAUDE.md') && generated.trim() === '@AGENTS.md') unlinkSync(path);
  }
}
