import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pathname = '/';
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'next/link') return function MockLink({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (request === 'next/navigation') return { usePathname: () => pathname };
  if (request === '@/app/sign-out-action') return { signOutAction: async () => {} };
  return originalLoad.call(this, request, parent, isMain);
};
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { Shell } = require(path.join(root, 'components/shell.tsx'));
Module._load = originalLoad;

function render(user, route = '/') {
  pathname = route;
  return renderToStaticMarkup(React.createElement(Shell, { user }, React.createElement('div', null, 'Page content')));
}

test('authenticated shell displays CRM name and friendly role for every role', () => {
  const roles = { ADMIN: 'Administrator', SALES_MANAGER: 'Sales Manager', SALES: 'Sales', MARKETING_MANAGER: 'Marketing Manager', READ_ONLY: 'Read Only' };
  for (const [role, label] of Object.entries(roles)) {
    const html = render({ name: 'Chad Guenther', role, canManageUsers: role === 'ADMIN' });
    assert.match(html, /Chad Guenther/);
    assert.ok(html.includes(`>${label}</div>`));
    assert.match(html, /Sign out/);
    assert.equal(html.includes('href="/administration"'), role === 'ADMIN');
  }
});

test('sign-in page does not show authenticated shell controls', () => {
  const html = render({ name: 'Chad Guenther', role: 'ADMIN', canManageUsers: true }, '/sign-in');
  assert.doesNotMatch(html, /Chad Guenther|Administrator|Sign out|href="\/administration"/);
  assert.match(html, /Page content/);
});
