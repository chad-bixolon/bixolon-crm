import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const originalLoad = Module._load;
const rows = [
  { id: 1, name: '7-Eleven', status: 'ACTIVE', archivedAt: null },
  { id: 2, name: 'Bluestar', status: 'ACTIVE', archivedAt: null },
  { id: 3, name: 'Specialty Printing', status: 'ACTIVE', archivedAt: null },
  { id: 4, name: '7-Eleven Old', status: 'INACTIVE', archivedAt: null },
  { id: 5, name: '7-Eleven Archived', status: 'ACTIVE', archivedAt: new Date() },
];
let sqlCalls = 0;
const prisma = { $queryRaw: async (strings, q, normalized) => {
  sqlCalls++;
  const sql = strings.join('?');
  assert.match(sql, /status = 'ACTIVE' AND "archivedAt" IS NULL/);
  assert.match(sql, /ORDER BY name ASC LIMIT 20/);
  return rows.filter(row => row.status === 'ACTIVE' && !row.archivedAt && (
    row.name.toLowerCase().includes(q.toLowerCase()) ||
    normalized && row.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalized)
  )).map(({ id, name }) => ({ id, name }));
} };
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
Module._load = function(request, parent, isMain) {
  if (request === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
  if (request === '@/lib/current-user') return { requirePermission: async () => {} };
  if (request === '@/lib/prisma') return { prisma };
  return originalLoad.call(this, request, parent, isMain);
};
const { GET } = require(path.join(root, 'app/products/odm-search/route.ts'));
Module._load = originalLoad;
const search = async q => (await GET({ nextUrl: new URL(`http://localhost/products/odm-search?kind=account&q=${encodeURIComponent(q)}`) })).body.items;

test('one-character and normalized partial Account searches return active Account ids and labels', async () => {
  assert.deepEqual(await search('7'), [{ id: 1, label: '7-Eleven' }]);
  assert.deepEqual(await search('7eleven'), [{ id: 1, label: '7-Eleven' }]);
  assert.deepEqual(await search('BLUE STAR'), [{ id: 2, label: 'Bluestar' }]);
  assert.deepEqual(await search('specialty printing'), [{ id: 3, label: 'Specialty Printing' }]);
  const before = sqlCalls;
  assert.deepEqual(await search(''), []);
  assert.equal(sqlCalls, before);
});
