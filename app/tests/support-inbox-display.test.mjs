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

const { inboxTriageState, inboxMatchesView, inboxTriageCounts, inboxScopeWording } = require('../lib/support-inbox-display.ts');
const { SUPPORT_GMAIL_INBOX_LIMIT, supportGmailLookbackDays } = require('../lib/support-gmail-config.ts');

test('triage uses persisted links and existing review flags; suggestions alone are not links', () => {
  const rows = [empty, { ...empty, linkedThreadCaseId: 1, suggestedCases: [caseRow] }, { ...empty, ambiguousContact: true }, { ...empty, alreadyLinkedCaseId: 1, ambiguousContact: true }].map(inboxTriageState);
  assert.deepEqual(rows, [{ unlinked: true, needsReview: false }, { unlinked: true, needsReview: false }, { unlinked: true, needsReview: true }, { unlinked: false, needsReview: false }]);
  assert.deepEqual(rows.filter(row => inboxMatchesView(row, 'all')), rows);
  assert.equal(rows.filter(row => inboxMatchesView(row, 'unlinked')).length, 3);
  assert.deepEqual(rows.filter(row => inboxMatchesView(row, 'needs-review')), [rows[2]]);
  assert.deepEqual(inboxTriageCounts(rows), { all: 4, unlinked: 3, 'needs-review': 1 });
  assert.deepEqual(inboxTriageCounts([]), { all: 0, unlinked: 0, 'needs-review': 0 });
  for (const flag of [{ threadConflict: true }, { caseReferenceConflict: true }, { multipleCaseReferences: true }, { ambiguousContact: true }, { relatedCaseCount: 2 }]) {
    assert.equal(inboxTriageState({ ...empty, ...flag }).needsReview, true);
    assert.equal(inboxTriageState({ ...empty, ...flag, alreadyLinkedCaseId: 1 }).needsReview, false);
  }
});

test('scope reflects configured lookback and shared cap even when ignored or filtered messages reduce the display', () => {
  const previous = process.env.SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS;
  try {
    for (const days of [1, 20, 30, 365]) {
      process.env.SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS = String(days);
      for (const shown of [0, 1, 3, 18, SUPPORT_GMAIL_INBOX_LIMIT]) {
        assert.equal(inboxScopeWording(shown, SUPPORT_GMAIL_INBOX_LIMIT, supportGmailLookbackDays()), `${shown} message${shown === 1 ? '' : 's'} shown · Up to 50 messages from the last ${days} day${days === 1 ? '' : 's'}`);
      }
    }
    assert.equal(inboxScopeWording(3, 25, 7), '3 messages shown · Up to 25 messages from the last 7 days');
  } finally {
    if (previous === undefined) delete process.env.SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS;
    else process.env.SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS = previous;
  }
});
