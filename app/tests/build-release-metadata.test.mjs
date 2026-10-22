import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { schemaFingerprint } from '../lib/prisma-schema-fingerprint.mjs';

const generator = fileURLToPath(new URL('../scripts/build-release-metadata.mjs', import.meta.url));
const schema = 'model Item {\n id Int @id\n label String @default("a b // literal")\n}\n';
const hash = value => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'saleshub-metadata-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'prisma/migrations/one'), { recursive: true });
  writeFileSync(join(cwd, 'prisma/schema.prisma'), schema);
  writeFileSync(join(cwd, 'prisma/migrations/one/migration.sql'), 'CREATE TABLE item (id integer);\n');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '0.1.0', dependencies: { '@prisma/client': '6.19.3' } }));
  // A config loader or Prisma CLI invocation must fail even if somebody adds a
  // placeholder URL later. The fixture has no dependencies or generated client.
  writeFileSync(join(cwd, 'prisma.config.ts'), 'throw new Error("Prisma config must never load during metadata generation");');
  const guard = join(cwd, 'no-external-io.cjs');
  writeFileSync(guard, `
    const deny = () => { throw new Error('Metadata must not spawn processes or connect to a database/network'); };
    const child = require('node:child_process');
    for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) child[name] = deny;
    const net = require('node:net');
    net.connect = net.createConnection = net.Socket.prototype.connect = deny;
    require('node:tls').connect = deny;
    require('node:dgram').createSocket = deny;
    require('node:module').syncBuiltinESMExports();
    if ('DATABASE_URL' in process.env) throw new Error('DATABASE_URL must be completely unset');
  `);
  return { cwd, generate: () => {
    const result = spawnSync(process.execPath, ['--require', guard, generator], { cwd, env: { LANG: 'C', CHECKPOINT_DISABLE: '1' }, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return JSON.parse(readFileSync(join(cwd, 'release-metadata.json'), 'utf8'));
  } };
}

test('metadata succeeds without DATABASE_URL, Prisma config resolution, dependencies, subprocesses or network access', t => {
  const { generate } = fixture(t);
  const manifest = generate();
  assert.equal(manifest.format, 2);
  assert.equal(manifest.schemaHash, hash(schema));
  assert.equal(manifest.normalizedSchemaHash, schemaFingerprint(schema));
  assert.equal(manifest.prismaVersion, '6.19.3');
  assert.deepEqual(manifest.migrations, [{ name: 'one', checksum: hash('CREATE TABLE item (id integer);\n') }]);
});

test('identical schema inputs produce identical schema metadata and meaningful changes alter both fingerprints', t => {
  const { cwd, generate } = fixture(t);
  const first = generate(), second = generate();
  const schemaMetadata = m => ({ schemaHash: m.schemaHash, normalizedSchemaHash: m.normalizedSchemaHash, prismaVersion: m.prismaVersion, migrations: m.migrations });
  assert.deepEqual(schemaMetadata(first), schemaMetadata(second));
  writeFileSync(join(cwd, 'prisma/schema.prisma'), schema.replace('label String', 'label String?'));
  const changed = generate();
  assert.notEqual(changed.schemaHash, first.schemaHash);
  assert.notEqual(changed.normalizedSchemaHash, first.normalizedSchemaHash);
});

test('normalization ignores layout while preserving literals, comments, token boundaries and schema meaning', () => {
  assert.equal(schemaFingerprint(schema), schemaFingerprint(schema.replace(' id Int', '    id      Int').replaceAll('\n', '\r\n')));
  for (const changed of [schema.replace('Int', 'BigInt'), schema.replace('label String', 'label String?'), schema.replace('a b // literal', 'a  b // literal'), schema.replace('@id', '@unique')]) {
    assert.notEqual(schemaFingerprint(schema), schemaFingerprint(changed));
  }
  assert.notEqual(schemaFingerprint('a b'), schemaFingerprint('ab'));
  assert.notEqual(schemaFingerprint('// first\nmodel A {}'), schemaFingerprint('// second\nmodel A {}'));
  const escaped = 'value String @default("say \\"hi\\" // value")';
  assert.equal(schemaFingerprint(escaped), schemaFingerprint('  ' + escaped + '\n'));
  assert.throws(() => schemaFingerprint('value String @default("unterminated)'), /Unterminated/);
  assert.throws(() => schemaFingerprint('/* unterminated'), /Unterminated/);
});
