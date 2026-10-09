import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const service = require(path.join(root, 'lib/support-attachments.ts'));
const keys = require(path.join(root, 'lib/document-storage-config.ts'));
const rules = require(path.join(root, 'lib/support-attachment-rules.ts'));
const timeline = require(path.join(root, 'lib/support-case-timeline.ts'));
const actor = role => ({ id: role === 'SUPPORT' ? 2 : 3, role, active: true, archivedAt: null });
const file = { originalFileName: 'sample.prn', mimeType: 'text/plain', fileSize: 8, body: new Uint8Array([1, 2]) };
function fixture(caseRow = { id: 11, accountId: 1, status: 'OPEN', archivedAt: null }) {
  let sequence = 0;
  const rows = [];
  const db = {
    supportCase: { findFirst: async ({ where }) => caseRow && where.AND[0].id === caseRow.id && (actor('SUPPORT') || where.AND[1]) ? caseRow : null },
    supportCaseAttachment: {
      create: async ({ data }) => { const row = { id: ++sequence, ...data, deletedAt: null }; rows.push(row); return row; },
      findUnique: async ({ where }) => rows.find(row => row.id === where.id) ?? null,
      updateMany: async ({ where, data }) => { const row = rows.find(item => item.id === where.id && item.deletedAt === null); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    },
  };
  const calls = [];
  const storage = { createSupportKey: () => keys.createSupportAttachmentKey('dev'), uploadDocumentObject: async input => calls.push(['upload', input]), deleteDocumentObject: async key => calls.push(['delete', key]), createSignedDocumentUrl: async input => { calls.push(['sign', input]); return 'https://signed.invalid/temporary'; } };
  return { db, storage, rows, calls };
}

test('safe case object keys are unique and exclude filenames and IDs', () => {
  const a = keys.createSupportAttachmentKey('dev'); const b = keys.createSupportAttachmentKey('dev');
  assert.match(a, /^dev\/support-cases\/[0-9a-f-]{36}$/); assert.notEqual(a, b);
  assert.doesNotMatch(a, /sample|\.prn|\/11\//);
  keys.assertStorageKeyInPrefix(a, 'dev');
  assert.throws(() => keys.assertStorageKeyInPrefix('dev/support-cases/../secret', 'dev'));
});

test('file envelope accepts diagnostic text and verifies size, type, and safe name', () => {
  assert.equal(rules.validateSupportAttachmentEnvelope('../sample.prn', 'application/octet-stream', 42).originalFileName, 'sample.prn');
  assert.equal(rules.validateSupportAttachmentEnvelope('photo.JPG', 'image/jpeg', 42).mimeType, 'image/jpeg');
  assert.throws(() => rules.validateSupportAttachmentEnvelope('malware.exe', 'application/octet-stream', 42), /not supported/);
  assert.throws(() => rules.validateSupportAttachmentEnvelope('photo.jpg', 'text/html', 42), /not supported/);
  assert.throws(() => rules.validateSupportAttachmentEnvelope('sample.log', 'text/plain', 25 * 1024 * 1024 + 1), /too large/);
  rules.validateSupportTextBytes(new TextEncoder().encode('^XA sample'));
  assert.throws(() => rules.validateSupportTextBytes(Uint8Array.from([0x4d, 0x5a, 0])), /not supported/);
});

test('upload creates metadata after object and allows duplicate display names', async () => {
  const f = fixture();
  await service.uploadSupportAttachment(f.db, f.storage, actor('SUPPORT'), 11, file);
  await service.uploadSupportAttachment(f.db, f.storage, actor('SUPPORT'), 11, file);
  assert.equal(f.rows.length, 2); assert.notEqual(f.rows[0].storageKey, f.rows[1].storageKey);
  assert.equal(f.rows[0].originalFileName, 'sample.prn'); assert.equal(f.rows[0].body, undefined);
  assert.deepEqual(f.calls.map(call => call[0]), ['upload', 'upload']);
});

test('read-only cannot upload or remove; inaccessible case cannot download', async () => {
  const f = fixture(); await service.uploadSupportAttachment(f.db, f.storage, actor('SUPPORT'), 11, file);
  await assert.rejects(service.uploadSupportAttachment(f.db, f.storage, actor('READ_ONLY'), 11, file), /Access denied/);
  await assert.rejects(service.removeSupportAttachment(f.db, f.storage, actor('READ_ONLY'), 1), /Access denied/);
  await assert.rejects(service.supportAttachmentDownloadUrl(fixture(null).db, f.storage, actor('READ_ONLY'), 1), /not found/);
  assert.equal(await service.supportAttachmentDownloadUrl(f.db, f.storage, actor('READ_ONLY'), 1), 'https://signed.invalid/temporary');
});

test('Closed and Archived cases block changes but allow existing downloads', async () => {
  for (const caseRow of [{ id: 11, status: 'CLOSED', archivedAt: null, accountId: 1 }, { id: 11, status: 'RESOLVED', archivedAt: new Date(), accountId: 1 }]) {
    const f = fixture(caseRow);
    await assert.rejects(service.uploadSupportAttachment(f.db, f.storage, actor('SUPPORT'), 11, file), /Closed or Archived/);
    f.rows.push({ id: 1, supportCaseId: 11, storageKey: 'dev/support-cases/fixture', deletedAt: null });
    await assert.rejects(service.removeSupportAttachment(f.db, f.storage, actor('SUPPORT'), 1), /Closed or Archived/);
    assert.equal(await service.supportAttachmentDownloadUrl(f.db, f.storage, actor('SUPPORT'), 1), 'https://signed.invalid/temporary');
    assert.equal(f.calls.some(call => call[0] === 'delete'), false);
  }
  const resolved = fixture({ id: 11, status: 'RESOLVED', archivedAt: null, accountId: 1 });
  await service.uploadSupportAttachment(resolved.db, resolved.storage, actor('SUPPORT'), 11, file);
  assert.equal(resolved.rows.length, 1);
});

test('removal records actor and blocks subsequent downloads', async () => {
  const f = fixture(); await service.uploadSupportAttachment(f.db, f.storage, actor('SUPPORT'), 11, file);
  const key = f.rows[0].storageKey;
  await service.removeSupportAttachment(f.db, f.storage, actor('SUPPORT'), 1);
  assert.deepEqual(f.calls.find(call => call[0] === 'delete'), ['delete', key]);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].originalFileName, 'sample.prn');
  assert.equal(f.rows[0].contentType, 'text/plain');
  assert.equal(f.rows[0].fileSizeBytes, 8);
  assert.equal(f.rows[0].uploadedByUserId, 2);
  assert.ok(f.rows[0].deletedAt instanceof Date); assert.equal(f.rows[0].deletedByUserId, 2);
  await assert.rejects(service.supportAttachmentDownloadUrl(f.db, f.storage, actor('SUPPORT'), 1), /not found/);
  assert.equal(f.calls.filter(call => call[0] === 'sign').length, 0);
  const viewDb = { ...f.db, supportCaseLifecycleEvent: { findMany: async () => [] }, activity: { findMany: async () => [] }, task: { findMany: async () => [] }, note: { findMany: async () => [] } };
  viewDb.supportCaseAttachment.findMany = async () => f.rows.map(row => ({ ...row, createdAt: new Date('2026-10-09T00:00:00Z'), uploadedBy: { firstName: 'E2E', lastName: 'support' }, deletedBy: { firstName: 'E2E', lastName: 'support' } }));
  const history = await timeline.caseHistoryView(viewDb, 11, new Date('2026-10-09T00:00:00Z'), 'America/New_York');
  assert.deepEqual(history.timeline.filter(item => item.title === 'Attachment removed').map(item => ({ detail: item.detail, actor: item.actor })), [{ detail: 'sample.prn', actor: 'E2E support' }]);
  await service.removeSupportAttachment(f.db, f.storage, actor('SUPPORT'), 1);
  assert.equal(f.calls.filter(call => call[0] === 'delete').length, 1);
  assert.equal(f.rows[0].deletedByUserId, 2);
});

test('storage deletion failure leaves attachment active', async () => {
  const f = fixture(); await service.uploadSupportAttachment(f.db, f.storage, actor('SUPPORT'), 11, file);
  f.storage.deleteDocumentObject = async () => { throw new Error('storage unavailable'); };
  const originalError = console.error; console.error = () => {};
  try { await assert.rejects(service.removeSupportAttachment(f.db, f.storage, actor('SUPPORT'), 1), /could not be removed/); }
  finally { console.error = originalError; }
  assert.equal(f.rows[0].deletedAt, null);
  assert.equal(await service.supportAttachmentDownloadUrl(f.db, f.storage, actor('SUPPORT'), 1), 'https://signed.invalid/temporary');
});

test('database failure after deletion is reported and a retry reconciles metadata', async () => {
  const f = fixture(); await service.uploadSupportAttachment(f.db, f.storage, actor('SUPPORT'), 11, file);
  const update = f.db.supportCaseAttachment.updateMany;
  f.db.supportCaseAttachment.updateMany = async () => { throw new Error('database unavailable'); };
  const originalError = console.error; console.error = () => {};
  try { await assert.rejects(service.removeSupportAttachment(f.db, f.storage, actor('SUPPORT'), 1), /file was deleted, but its case record/); }
  finally { console.error = originalError; }
  assert.equal(f.rows[0].deletedAt, null);
  f.db.supportCaseAttachment.updateMany = update;
  await service.removeSupportAttachment(f.db, f.storage, actor('SUPPORT'), 1);
  assert.ok(f.rows[0].deletedAt instanceof Date);
});

test('failed database insert compensates the uploaded object', async () => {
  const f = fixture(); f.db.supportCaseAttachment.create = async () => { throw new Error('database failed'); };
  await assert.rejects(service.uploadSupportAttachment(f.db, f.storage, actor('SUPPORT'), 11, file), /database failed/);
  assert.deepEqual(f.calls.map(call => call[0]), ['upload', 'delete']);
});
