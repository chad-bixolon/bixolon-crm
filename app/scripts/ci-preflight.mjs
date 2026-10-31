import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { assertNpmToolchain, runtimeSupported } from './release-check.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const pin = readFileSync('.nvmrc', 'utf8').trim();
const dockerfile = readFileSync('Dockerfile', 'utf8');

assert.equal(pin, '22.23.4', 'Review the CI runtime policy before changing Node.');
assert.equal(process.version, `v${pin}`, 'GitHub must use the exact .nvmrc runtime.');
const npmVersion = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8' }).trim();
assertNpmToolchain(pkg, npmVersion);
assert.equal(lock.packages[''].engines.npm, pkg.engines.npm);
const recovery = JSON.parse(readFileSync('scripts/operations/recovery-runtime/package.json', 'utf8'));
const recoveryLock = JSON.parse(readFileSync('scripts/operations/recovery-runtime/package-lock.json', 'utf8'));
assertNpmToolchain(recovery, npmVersion);
assert.equal(recovery.engines.node, pkg.engines.node);
assert.equal(recoveryLock.packages[''].engines.npm, pkg.engines.npm);
assert.ok(runtimeSupported(process.version, pkg.engines.node), 'Node does not meet the package engine policy.');
assert.equal(pkg.dependencies.prisma, '6.19.3');
assert.equal(pkg.dependencies['@prisma/client'], '6.19.3');
for (const name of ['prisma', '@prisma/client']) {
  assert.equal(lock.packages[`node_modules/${name}`]?.version, '6.19.3', `Locked ${name} version drifted.`);
}
for (const stage of ['development', 'production-base']) {
  assert.match(dockerfile, new RegExp(`^FROM node:${pin}-(?:alpine|bookworm-slim) AS ${stage}$`, 'm'));
  assert.match(dockerfile, new RegExp(`AS ${stage}\\nRUN npm install --global npm@12\\.2\\.1`));
}
const operationsDockerfile = readFileSync('Dockerfile.operations', 'utf8');
assert.match(operationsDockerfile, new RegExp(`^FROM node:${pin}-bookworm-slim AS node-runtime$`, 'm'));
assert.match(operationsDockerfile, /AS node-runtime\nRUN npm install --global npm@12\.2\.1/);
for (const name of ['prisma', '@prisma/client']) {
  assert.equal(recovery.dependencies[name], '6.19.3');
  assert.equal(recoveryLock.packages[`node_modules/${name}`]?.version, '6.19.3');
}
console.log(`Runtime and both lockfiles aligned: Node ${pin}, npm ${npmVersion}, Prisma CLI/client 6.19.3.`);
