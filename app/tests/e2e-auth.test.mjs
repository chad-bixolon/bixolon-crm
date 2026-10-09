import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { e2eAuthEnabled } = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/e2e-auth.ts'));
const allowed = { NODE_ENV: 'development', E2E_AUTH_ENABLED: 'true', E2E_AUTH_TOKEN: 'secret', DATABASE_URL: 'postgresql://user:pass@127.0.0.1:55432/saleshub_e2e' };

test('E2E credentials cannot activate in production or on another database host/name', () => {
  assert.equal(e2eAuthEnabled(allowed), true);
  assert.equal(e2eAuthEnabled({ ...allowed, NODE_ENV: 'production' }), false);
  assert.equal(e2eAuthEnabled({ ...allowed, E2E_AUTH_ENABLED: 'false' }), false);
  assert.equal(e2eAuthEnabled({ ...allowed, E2E_AUTH_TOKEN: '' }), false);
  assert.equal(e2eAuthEnabled({ ...allowed, DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/saleshub_dev' }), false);
  assert.equal(e2eAuthEnabled({ ...allowed, DATABASE_URL: 'postgresql://user:pass@db:5432/saleshub_e2e' }), false);
});
