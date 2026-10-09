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
const originalTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
Module._load = function(request, parent, isMain) {
  if (request === 'react') return {
    startTransition: callback => callback(),
    useRef: value => ({ current: value }),
    useEffect: callback => callback(),
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { submitPreservingForm, useResetOnSuccess } = require(path.join(root, 'lib/submit-preserving-form.ts'));
const { useSubmitGuard } = require(path.join(root, 'lib/submit-guard.ts'));
Module._load = originalLoad;
Module._extensions['.ts'] = originalTs;

class Element { getAttribute(name) { return this[name] ?? null; } }
const oldElement = globalThis.HTMLElement;
const oldFormData = globalThis.FormData;
globalThis.HTMLElement = Element;
globalThis.FormData = class {
  constructor(form, submitter) {
    this.values = new Map(form.values);
    if (submitter) this.values.set(submitter.name, submitter.value);
  }
  get(key) { return this.values.get(key); }
};

test('failed action keeps live text, select, date, and picker ID plus label', () => {
  const form = { values: new Map([['name', 'Edited'], ['status', 'ACTIVE'], ['dueDate', '2026-10-10'], ['accountId', '42'], ['accountIdLabel', 'Acme'], ['productQuery', 'XD5']]) };
  let prevented = false;
  let submitted;
  submitPreservingForm({ currentTarget: form, nativeEvent: {}, preventDefault: () => { prevented = true; } }, data => { submitted = data; return { error: 'Required field missing.' }; });
  assert.equal(prevented, true);
  for (const [key, value] of form.values) assert.equal(submitted.get(key), value);
  assert.equal(form.values.get('name'), 'Edited');
  assert.equal(form.values.get('accountIdLabel'), 'Acme');
});

test('guard carries the clicked review button and blocks a duplicate submission', () => {
  const form = { values: new Map([['name', 'Edited']]), querySelector: () => ({ disabled: false, textContent: 'Save' }) };
  const submitter = Object.assign(new Element(), { name: 'reviewedOpportunity', value: 'review-token' });
  const submissions = [];
  const guard = useSubmitGuard({}, data => submissions.push(data));
  let prevented = 0;
  const event = { currentTarget: form, nativeEvent: { submitter }, preventDefault: () => { prevented++; } };
  guard(event);
  guard(event);
  assert.equal(prevented, 2);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].get('reviewedOpportunity'), 'review-token');
  assert.equal(submissions[0].get('name'), 'Edited');
});

test('form reset happens after success and never after validation failure', () => {
  let resets = 0;
  const ref = { current: { reset: () => { resets++; } } };
  useResetOnSuccess({ error: 'Invalid value.' }, false, ref);
  assert.equal(resets, 0);
  useResetOnSuccess({ success: true }, true, ref);
  assert.equal(resets, 1);
});

test.after(() => {
  globalThis.HTMLElement = oldElement;
  globalThis.FormData = oldFormData;
});
