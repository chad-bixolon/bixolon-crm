import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { contactDuplicateMatches, contactSaveReview, contactIdentityChanged } = require(path.join(root, 'lib/contact-duplicates.ts'));
const input = { firstName: 'John', lastName: 'Smith', email: 'john@example.com', accountId: 1, title: null, phone: null, mobile: null, active: true, isPrimary: false, marketingPreference: 'UNKNOWN', addressLine1: null, addressLine2: null, city: null, stateProvince: null, postalCode: null, country: null };
const candidate = (overrides = {}) => ({ id: 10, firstName: 'John', lastName: 'Smith', email: 'john@example.com', accountId: 1, account: { name: 'Acme' }, title: 'Buyer', active: true, archivedAt: null, ...overrides });
const client = candidates => ({ contact: { findMany: async () => candidates } });

test('exact email is strongest even when names or Accounts differ', () => {
  const matches = contactDuplicateMatches(input, [candidate({ firstName: 'Jane', lastName: 'Doe', accountId: 2, account: { name: 'Other Co' }, email: ' JOHN@EXAMPLE.COM ' })]);
  assert.equal(matches[0].reason, 'email');
  assert.equal(matches[0].accountName, 'Other Co');
  assert.equal(matches[0].title, 'Buyer');
});

test('same normalized name and Account warns; different assigned Accounts do not', () => {
  const same = candidate({ firstName: '  JOHN  ', lastName: 'Smith ', email: null });
  assert.equal(contactDuplicateMatches(input, [same])[0].reason, 'same-account-name');
  assert.deepEqual(contactDuplicateMatches(input, [candidate({ ...same, accountId: 2, account: { name: 'Other Co' } })]), []);
  assert.equal(contactDuplicateMatches(input, [candidate({ ...same, accountId: null, account: null })])[0].reason, 'unassigned-name');
  assert.equal(contactDuplicateMatches({ ...input, accountId: null }, [same])[0].reason, 'unassigned-name');
});

test('archived and inactive matches remain visible with status and context', () => {
  const archived = contactDuplicateMatches(input, [candidate({ archivedAt: new Date('2026-01-01'), active: false })])[0];
  assert.equal(archived.archived, true);
  assert.equal(archived.inactive, false);
  const inactive = contactDuplicateMatches(input, [candidate({ active: false })])[0];
  assert.equal(inactive.inactive, true);
  assert.equal(inactive.archived, false);
});

test('edit excludes itself, but a changed email matching another Contact warns', async () => {
  assert.deepEqual(contactDuplicateMatches(input, [candidate()], 10), []);
  assert.equal(contactIdentityChanged(input, { ...input, title: 'New title' }), false);
  assert.equal(contactIdentityChanged(input, { ...input, email: 'other@example.com' }), true);
  const other = candidate({ id: 11, firstName: 'Jane', lastName: 'Doe', email: 'other@example.com' });
  const review = await contactSaveReview(client([candidate(), other]), { ...input, email: 'other@example.com' }, new FormData(), 10, input);
  assert.equal(review.matches.length, 1);
  assert.equal(review.matches[0].id, 11);
  assert.equal(review.matches[0].reason, 'email');
  assert.equal(await contactSaveReview(client([candidate(), other]), { ...input, title: 'New title' }, new FormData(), 10, input), null);
});

test('create-anyway requires the review token for the current input and matches', async () => {
  const store = client([candidate()]);
  const review = await contactSaveReview(store, input, new FormData());
  assert.equal(review.matches.length, 1);
  assert.ok(await contactSaveReview(store, input, new FormData()));
  const acknowledged = new FormData();
  acknowledged.set('reviewedContact', review.reviewToken);
  assert.equal(await contactSaveReview(store, input, acknowledged), null);
  assert.ok(await contactSaveReview(store, { ...input, title: 'Updated' }, acknowledged));
  assert.ok(await contactSaveReview(client([candidate(), candidate({ id: 11 })]), input, acknowledged));
  assert.ok(await contactSaveReview(client([candidate({ active: false })]), input, acknowledged));
});

test('no plausible match proceeds without a warning', async () => {
  const unrelated = candidate({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', accountId: 2 });
  assert.deepEqual(contactDuplicateMatches(input, [unrelated]), []);
  assert.equal(await contactSaveReview(client([unrelated]), input, new FormData()), null);
});

test('normal Contact action and form wire review before save with an existing Contact link', () => {
  const action = fs.readFileSync(path.join(root, 'app/contacts/actions.ts'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'components/contact-form.tsx'), 'utf8');
  assert.ok(action.indexOf('contactSaveReview(') < action.indexOf('saveContact('));
  assert.match(action, /contactSaveReview\(prisma, parsed\.value, form, id \?\? undefined, previous\)/);
  assert.match(form, /Possible duplicate Contact found/);
  assert.match(form, /A Contact with this email already exists/);
  assert.match(form, /Open existing Contact/);
  assert.match(form, /href=\{`\/contacts\/\$\{match\.id\}`\}/);
  assert.match(form, /match\.archived \? ' — Archived' : match\.inactive \? ' — Inactive'/);
  assert.match(form, /name=\{state\.matches\?\.length \? 'reviewedContact' : undefined\}/);
  assert.match(form, /Create new Contact anyway/);
});
