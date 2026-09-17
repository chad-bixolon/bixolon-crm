import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(fileURLToPath(import.meta.url));
const signInCalls = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@/auth') return { signIn: async (...args) => { signInCalls.push(args); } };
  return originalLoad.call(this, request, parent, isMain);
};
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const SignInPage = require(path.join(root, 'app/sign-in/page.tsx')).default;
Module._load = originalLoad;

function find(element, type) {
  if (!element || typeof element !== 'object') return null;
  if (element.type === type) return element;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = find(child, type);
    if (match) return match;
  }
  return null;
}

test('sign-in page shows centered CRM branding and one Google action', () => {
  const page = SignInPage();
  const html = renderToStaticMarkup(page);
  assert.match(html, /min-h-screen items-center justify-center/);
  assert.match(html, /BIXOLON America/);
  assert.match(html, /src="\/brand\/bixolon-logo.png"/);
  assert.match(html, /width="500" height="40"/);
  assert.match(html, /class="mx-auto block h-auto w-full max-w-\[320px\]"/);
  assert.match(html, /<h1[^>]*>Sign in<\/h1>/);
  assert.match(html, /BIXOLON America Sales CRM/);
  assert.match(html, /Use your approved BIXOLON corporate account\./);
  assert.match(html, /Sign in with your Google account/);
  assert.match(html, /fill="#4285F4"/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /border-slate-300 bg-white/);
});

test('Google button retains the existing OAuth action and redirect', async () => {
  const form = find(SignInPage(), 'form');
  assert.ok(form);
  await form.props.action();
  assert.deepEqual(signInCalls, [['google', { redirectTo: '/' }]]);
});
