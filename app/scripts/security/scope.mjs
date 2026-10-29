import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function securityScope(paths, event) {
  if (event !== 'pull_request') return { dependency: true, production: true, operations: true };
  const shared = paths.some(p => /^\.github\/(workflows\/|actions\/scan-image\/)/.test(p)
    || /^app\/(scripts\/security\/|security\/)/.test(p));
  return {
    dependency: shared || paths.some(p => /^app\/(?:scripts\/operations\/recovery-runtime\/)?package(?:-lock)?\.json$/.test(p)),
    production: shared || paths.some(p => p.startsWith('app/') && !/^app\/(docs\/|tests\/|e2e\/|Dockerfile\.operations$)/.test(p)),
    operations: shared || paths.some(p => /^app\/(Dockerfile\.operations$|\.dockerignore$|prisma\/|prisma\.config\.ts$|scripts\/prisma-generate\.mjs$|scripts\/operations\/)/.test(p)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.env.EVENT_NAME === 'pull_request'
    ? execFileSync('git', ['diff', '--name-only', process.env.PR_BASE_SHA, 'HEAD'], { encoding: 'utf8' }).trim().split('\n') : [];
  const scope = securityScope(paths, process.env.EVENT_NAME);
  for (const [key, value] of Object.entries(scope)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(JSON.stringify(scope));
}
