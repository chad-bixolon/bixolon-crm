import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtimeSupported } from './release-check.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const pin = readFileSync('.nvmrc', 'utf8').trim();
const dockerfile = readFileSync('Dockerfile', 'utf8');

assert.equal(pin, '22.23.4', 'Review the CI runtime policy before changing Node.');
assert.equal(process.version, `v${pin}`, 'GitHub must use the exact .nvmrc runtime.');
assert.ok(runtimeSupported(process.version, pkg.engines.node), 'Node does not meet the package engine policy.');
assert.equal(pkg.dependencies.prisma, '6.19.3');
assert.equal(pkg.dependencies['@prisma/client'], '6.19.3');
for (const name of ['prisma', '@prisma/client']) {
  assert.equal(lock.packages[`node_modules/${name}`]?.version, '6.19.3', `Locked ${name} version drifted.`);
}
for (const stage of ['development', 'production-base']) {
  assert.match(dockerfile, new RegExp(`^FROM node:${pin}-(?:alpine|bookworm-slim) AS ${stage}$`, 'm'));
}
console.log(`Runtime and lockfile aligned: Node ${pin}, Prisma CLI/client 6.19.3.`);
