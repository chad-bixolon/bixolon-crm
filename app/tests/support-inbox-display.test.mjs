import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { inboxMatchSummary, inboxAttachmentLabel } = require('../lib/support-inbox-display.ts');
const empty = { contact: null, account: null, suggestedCases: [], linkedThreadCaseId: null, numberedCaseId: null, threadConflict: false, multipleCaseReferences: false, caseReferenceConflict: false, alreadyLinkedCaseId: null, ambiguousContact: false, relatedCaseCount: 0 };
const caseRow = { id: 1, caseNumber: 'BXS-2026-000123' };

test('summary keeps exact Account/Contact and a confident Case compact', () => {
  assert.equal(inboxMatchSummary(empty).summary, 'No confident CRM match');
  const contact = { firstName: 'Jane', lastName: 'Smith' };
  const account = { name: 'Acme Corp' };
  const suggestion = { ...empty, contact, account, suggestedCases: [caseRow], linkedThreadCaseId: 1 };
  assert.deepEqual(inboxMatchSummary(suggestion), { summary: 'Matched: Acme Corp · Jane Smith · Case BXS-2026-000123', confidence: 'Strong match', needsReview: false });
  assert.equal(inboxMatchSummary({ ...suggestion, linkedThreadCaseId: null, relatedCaseCount: 1 }).confidence, 'Suggested');
  assert.equal(inboxMatchSummary({ ...empty, contact }).summary, 'Matched: Jane Smith');
  assert.equal(inboxMatchSummary({ ...empty, suggestedCases: [caseRow], numberedCaseId: 1 }).summary, 'Matched: Case BXS-2026-000123');
});

test('conflicting or ambiguous Case suggestions are never presented as a confident Case match', () => {
  for (const conflict of [{ threadConflict: true }, { caseReferenceConflict: true }, { multipleCaseReferences: true }, { ambiguousContact: true }, { relatedCaseCount: 2 }]) {
    const suggestion = { ...empty, linkedThreadCaseId: 1, suggestedCases: [caseRow], ...conflict };
    const before = structuredClone(suggestion);
    assert.deepEqual(inboxMatchSummary(suggestion), { summary: 'No confident CRM match', confidence: 'Needs review', needsReview: true });
    assert.deepEqual(suggestion, before);
  }
});

test('attachment badge counts visible file metadata including unavailable files, without selecting or fetching files', () => {
  assert.equal(inboxAttachmentLabel({}), null);
  assert.equal(inboxAttachmentLabel({ hasAttachments: true }), 'Attachments');
  assert.equal(inboxAttachmentLabel({ files: [{ hiddenReason: null }] }), '1 attachment');
  assert.equal(inboxAttachmentLabel({ files: [{ hiddenReason: null }, { hiddenReason: null, unavailableReason: 'Too large' }, { hiddenReason: 'Signature' }] }), '2 attachments');
  assert.equal(inboxAttachmentLabel({ files: [{ hiddenReason: 'Signature' }], hasAttachments: true }), 'Attachments');
});
