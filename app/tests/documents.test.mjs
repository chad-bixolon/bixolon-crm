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
const storageConfig = require(path.join(root, 'lib/document-storage-config.ts'));
const fileRules = require(path.join(root, 'lib/document-file-rules.ts'));
const documents = require(path.join(root, 'lib/documents.ts'));
const actor = (role, id = 7) => ({ id, role, active: true, archivedAt: null });

test('storage keys honor normalized dev/prod prefixes and never use original filenames', () => {
  const uuid = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(storageConfig.createDocumentStorageKey('/dev/', uuid), `dev/documents/${uuid}`);
  assert.equal(storageConfig.createDocumentStorageKey('prod', uuid), `prod/documents/${uuid}`);
  const generated = storageConfig.createDocumentStorageKey('dev');
  assert.match(generated, /^dev\/documents\/[0-9a-f-]{36}$/);
  assert.doesNotMatch(generated, /contract|customer|\.pdf/i);
  assert.throws(() => storageConfig.normalizeStoragePrefix('../prod'), /invalid/);
  assert.throws(() => storageConfig.normalizeStoragePrefix('dev\\documents'), /invalid/);
  assert.throws(() => storageConfig.assertStorageKeyInPrefix(`prod/documents/${uuid}`, 'dev'), /outside/);
});

test('storage configuration fails safely without exposing values', () => {
  assert.throws(() => storageConfig.readDocumentStorageConfig({}), /^Error: Document storage is not configured\.$/);
  assert.throws(() => storageConfig.readDocumentStorageConfig({ SPACES_BUCKET: 'b', SPACES_REGION: 'r', SPACES_ENDPOINT: 'not-a-url', SPACES_ACCESS_KEY_ID: 'private-id', SPACES_SECRET_ACCESS_KEY: 'private-secret', SPACES_PREFIX: 'dev' }), error => {
    assert.doesNotMatch(error.message, /private/); return true;
  });
});

test('document file rules enforce size, extension, MIME, and signatures', () => {
  assert.throws(() => fileRules.validateDocumentEnvelope('payload.sh', 'text/x-shellscript', 12), /Unsupported/);
  assert.throws(() => fileRules.validateDocumentEnvelope('quote.pdf', 'application/javascript', 12), /do not match/);
  assert.throws(() => fileRules.validateDocumentEnvelope('quote.pdf', 'application/pdf', 25 * 1024 * 1024 + 1), /25 MB/);
  const pdf = fileRules.validateDocumentEnvelope('../Customer Quote.pdf', 'application/pdf', 12);
  assert.equal(pdf.originalFileName, 'Customer Quote.pdf');
  assert.throws(() => fileRules.validateDocumentSignature(pdf.expected, Uint8Array.from([0x4d, 0x5a]), 'application/x-msdownload'), /contents do not match/);
  fileRules.validateDocumentSignature(pdf.expected, Uint8Array.from([0x25, 0x50, 0x44, 0x46]), 'application/pdf');
  const legacy = fileRules.validateDocumentEnvelope('proposal.doc', 'application/msword', 8);
  fileRules.validateDocumentSignature(legacy.expected, Uint8Array.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
});

function client(overrides = {}) {
  return {
    account: { findUnique: async () => ({ id: 10, status: 'ACTIVE', archivedAt: null }) },
    project: { findFirst: async () => ({ id: 10, ownerId: 7, primaryAccount: { ownerId: 8 }, archivedAt: null }) },
    opportunity: { findFirst: async ({ where }) => where.ownerId && where.ownerId !== 7 ? null : ({ id: 10, archivedAt: null }) },
    document: {
      create: async ({ data }) => ({ id: 1, ...data }),
      findUnique: async () => null,
      update: async ({ data }) => ({ id: 1, ...data }),
    },
    ...overrides,
  };
}
function storage() {
  const calls = [];
  return {
    calls,
    createKey: () => 'dev/documents/123e4567-e89b-42d3-a456-426614174000',
    uploadDocumentObject: async input => calls.push(['upload', input]),
    createSignedDocumentUrl: async input => { calls.push(['sign', input]); return 'https://signed.invalid/temporary'; },
    deleteObjectForFailedUpload: async key => calls.push(['delete', key]),
  };
}
const file = { originalFileName: 'Contract.pdf', mimeType: 'application/pdf', fileSize: 128, body: new Uint8Array([1]) };
const metadata = { documentType: 'CONTRACT', description: null };

test('permitted upload stores object first and then persists exactly one parent', async () => {
  let saved;
  const db = client({ document: { create: async ({ data }) => (saved = { id: 1, ...data }) } });
  const objects = storage();
  await documents.uploadDocument(db, objects, actor('SALES'), { type: 'opportunity', id: 10 }, file, metadata);
  assert.deepEqual(objects.calls.map(call => call[0]), ['upload']);
  assert.equal(saved.opportunityId, 10);
  assert.equal(saved.accountId, undefined); assert.equal(saved.projectId, undefined);
  assert.equal(saved.uploadedByUserId, 7);
});

test('unauthorized and READ_ONLY uploads are rejected before storage', async () => {
  for (const role of ['READ_ONLY', 'MARKETING_MANAGER']) {
    const objects = storage();
    await assert.rejects(documents.uploadDocument(client(), objects, actor(role), { type: 'opportunity', id: 10 }, file, metadata), /Access denied/);
    assert.deepEqual(objects.calls, []);
  }
});

test('database failure after upload triggers compensating object deletion', async () => {
  const objects = storage();
  const db = client({ document: { create: async () => { throw new Error('database unavailable'); } } });
  await assert.rejects(documents.uploadDocument(db, objects, actor('ADMIN'), { type: 'account', id: 10 }, file, metadata), /database unavailable/);
  assert.deepEqual(objects.calls.map(call => call[0]), ['upload', 'delete']);
});

test('parent authorization preserves Account, Project, Opportunity and role scopes', async () => {
  await documents.assertDocumentParentAccess(client(), actor('READ_ONLY'), { type: 'account', id: 10 }, 'read');
  await assert.rejects(documents.assertDocumentParentAccess(client(), actor('READ_ONLY'), { type: 'account', id: 10 }, 'write'), /Access denied/);
  await documents.assertDocumentParentAccess(client(), actor('SALES'), { type: 'project', id: 10 }, 'write');
  await assert.rejects(documents.assertDocumentParentAccess(client({ project: { findFirst: async () => ({ ownerId: 8, primaryAccount: { ownerId: 9 }, archivedAt: null }) } }), actor('SALES'), { type: 'project', id: 10 }, 'write'), /Access denied/);
  await documents.assertDocumentParentAccess(client(), actor('SALES_MANAGER'), { type: 'opportunity', id: 10 }, 'write');
  await assert.rejects(documents.assertDocumentParentAccess(client(), actor('MARKETING_MANAGER'), { type: 'opportunity', id: 10 }, 'read'), /Access denied/);
  await assert.rejects(documents.assertDocumentParentAccess(client({ opportunity: { findFirst: async () => null } }), actor('SALES'), { type: 'opportunity', id: 10 }, 'read'), /not found/);
});

test('authorized download signs at request time and archived documents remain accessible', async () => {
  const objects = storage();
  const db = client({ document: { findUnique: async () => ({ accountId: 10, projectId: null, opportunityId: null, archivedAt: new Date(), storageKey: 'dev/documents/id', originalFileName: 'NDA.pdf', mimeType: 'application/pdf' }) } });
  assert.equal(await documents.createDocumentDownloadUrl(db, objects, actor('READ_ONLY'), 1, true), 'https://signed.invalid/temporary');
  assert.deepEqual(objects.calls.map(call => call[0]), ['sign']);
  assert.equal('signedUrl' in (await db.document.findUnique()), false);
});

test('archive records actor/time and never invokes storage deletion', async () => {
  let update;
  const db = client({ document: {
    findUnique: async () => ({ accountId: 10, projectId: null, opportunityId: null, archivedAt: null }),
    update: async args => { update = args; return args.data; },
  } });
  await documents.archiveDocument(db, actor('ADMIN'), 1);
  assert.equal(update.data.archivedByUserId, 7);
  assert.ok(update.data.archivedAt instanceof Date);
  await assert.rejects(documents.archiveDocument(db, actor('READ_ONLY'), 1), /Access denied/);
});

test('schema, migration, and detail pages wire the V1 document invariants and UI', () => {
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20260924150000_document_attachments/migration.sql'), 'utf8');
  assert.match(schema, /enum DocumentType[\s\S]*STATEMENT_OF_WORK[\s\S]*TECHNICAL_DOCUMENT/);
  assert.match(migration, /num_nonnulls\("accountId", "projectId", "opportunityId"\) = 1/);
  assert.match(migration, /Document_storageKey_key/);
  const account = fs.readFileSync(path.join(root, 'app/accounts/[id]/page.tsx'), 'utf8');
  const project = fs.readFileSync(path.join(root, 'app/projects/[id]/page.tsx'), 'utf8');
  const opportunity = fs.readFileSync(path.join(root, 'app/opportunities/[id]/page.tsx'), 'utf8');
  for (const source of [account, project, opportunity]) assert.match(source, /DocumentsSection/);
  const section = fs.readFileSync(path.join(root, 'components/documents-section.tsx'), 'utf8');
  assert.match(section, /No documents have been uploaded/);
  assert.match(section, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/);
  for (const label of Object.values(documents.documentTypeLabels)) assert.match(section + JSON.stringify(documents.documentTypeLabels), new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('archived Document direct download is denied; explicit history access remains authorized',async()=>{
  const signer=storage();
  const document={accountId:null,projectId:null,opportunityId:10,archivedAt:new Date(),storageKey:'dev/documents/key',originalFileName:'old.pdf',mimeType:'application/pdf'};
  const db=client({document:{findUnique:async()=>document}});
  await assert.rejects(documents.createDocumentDownloadUrl(db,signer,actor('ADMIN'),1),/not found/i);
  assert.equal(signer.calls.length,0);
  await documents.createDocumentDownloadUrl(db,signer,actor('ADMIN'),1,true);
  assert.equal(signer.calls.length,1);
  await assert.rejects(documents.createDocumentDownloadUrl(db,signer,actor('MARKETING_MANAGER'),1,true),/Access denied/);
  assert.equal(signer.calls.length,1);
});

test('archived Document restore clears archive metadata after parent authorization',async()=>{
  let updated;
  const db=client({document:{findUnique:async()=>({accountId:10,projectId:null,opportunityId:null,archivedAt:new Date()}),update:async args=>(updated=args.data)}});
  await documents.restoreDocument(db,actor('ADMIN'),1);
  assert.deepEqual(updated,{archivedAt:null,archivedByUserId:null});
});
