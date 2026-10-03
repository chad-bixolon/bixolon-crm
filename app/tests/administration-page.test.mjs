import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(fileURLToPath(import.meta.url));
const originalTs = Module._extensions['.ts'];
const originalTsx = Module._extensions['.tsx'];
const originalLoad = Module._load;
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const { can, routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const actor = (role, active = true) => ({ id: 1, role, active, archivedAt: null });
let effective = actor('ADMIN');
const permissions = [];
Module._load = function(request, parent, isMain) {
  if (request === 'next/link') return function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (request === '@/components/shell') return {
    Content: ({ children }) => React.createElement('main', null, children),
    PageHeader: ({ title, description }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description)),
  };
  if (request === '@/lib/current-user') return { requirePermission: async permission => {
    permissions.push(permission);
    if (!can(effective, permission)) throw new Error('Access denied');
    return effective;
  } };
  return originalLoad.call(this, request, parent, isMain);
};
let AdministrationPage;
try { AdministrationPage = require(path.join(root, 'app/administration/page.tsx')).default; }
finally {
  Module._load = originalLoad;
  Module._extensions['.ts'] = originalTs;
  Module._extensions['.tsx'] = originalTsx;
}

const expected = [
  ['Data & Imports', [['Imports', '/administration/imports'], ['PE Cleanup', '/administration/price-exceptions']]],
  ['Users & Access', [['Users', '/administration/users'], ['Dashboard Views', '/administration/dashboard-views']]],
  ['Sales Configuration', [['Sales Stages', '/administration/sales-stages'], ['Sales Targets', '/administration/sales-targets'], ['Competitors', '/administration/competitors'], ['Territories', '/administration/lookups/territories']]],
  ['CRM Configuration', [['Industries', '/administration/lookups/industries'], ['Activity Types', '/administration/lookups/activity-types'], ['Labels & Terminology', '/administration/labels']]],
  ['Product Configuration', [['Product Categories', '/administration/lookups/product-categories']]],
  ['System & History', [['System Settings', '/administration/settings'], ['Opportunity & Forecast History', '/administration/history']]],
];

test('Administration renders every existing tool in its intended group and destination', async () => {
  effective = actor('ADMIN');
  const html = renderToStaticMarkup(await AdministrationPage()).replaceAll('&amp;', '&');
  assert.match(html, /<h1>Administration<\/h1>/);
  assert.match(html, /Manage users, CRM configuration, sales settings, and system tools\./);
  const sections = [...html.matchAll(/<section aria-labelledby="admin-group-(\d+)"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, expected.length);
  const actual = sections.map(([, id, content]) => {
    assert.match(content, new RegExp(`<h2[^>]*id="admin-group-${id}"[^>]*>`));
    assert.match(content, /class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"/);
    const heading = content.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1];
    const links = [...content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, body]) => {
      assert.match(attributes, /focus-visible:outline-2/);
      assert.match(body, /<p[^>]*>[^<]+<\/p>/);
      assert.match(body, /<span[^>]*>Manage →<\/span>/);
      return [body.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1], attributes.match(/href="([^"]+)"/)?.[1]];
    });
    return [heading, links];
  });
  assert.deepEqual(actual, expected);
  assert.equal(actual.flatMap(([, links]) => links).length, 14);
});

test('Administration keeps the effective-user management permission gate', async () => {
  permissions.length = 0;
  for (const role of ['SALES_MANAGER', 'SALES', 'MARKETING_MANAGER', 'READ_ONLY']) {
    effective = actor(role);
    assert.equal(routeAccess('/administration', effective), 'denied');
    await assert.rejects(AdministrationPage(), /Access denied/);
  }
  effective = actor('ADMIN', false);
  assert.equal(routeAccess('/administration', effective), 'denied');
  await assert.rejects(AdministrationPage(), /Access denied/);
  effective = actor('ADMIN');
  assert.equal(routeAccess('/administration', effective), 'allowed');
  assert.match(renderToStaticMarkup(await AdministrationPage()), /<h1>Administration<\/h1>/);
  assert.deepEqual(permissions, Array(6).fill('users.manage'));
});
