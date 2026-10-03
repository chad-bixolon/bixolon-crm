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
  if (request === 'next/image') return function MockImage({ src, alt, width, height, className }) { return React.createElement('img', { src, alt, width, height, className }); };
  if (request === 'next/navigation') return { usePathname: () => pathname };
  if (request === '@/app/sign-out-action') return { signOutAction: async () => {} };
  if (request === '@/app/dev/impersonation/actions') return { endImpersonation: async () => {} };
  if (request === '@/lib/role-labels') return require(path.join(root, 'lib/role-labels.ts'));
  return originalLoad.call(this, request, parent, isMain);
};
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { Shell } = require(path.join(root, 'components/shell.tsx'));
const { can, routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const { resolveUserContext } = require(path.join(root, 'lib/dev-impersonation.ts'));
Module._load = originalLoad;

function render(user, route = '/', extras = {}) {
  pathname = route;
  return renderToStaticMarkup(React.createElement(Shell, { user, ...extras }, React.createElement('div', null, 'Page content')));
}

test('development switcher is Admin-only and impersonation banner keeps return control for Sales', () => {
  const admin = { name: 'Chad Admin', role: 'ADMIN', canManageUsers: true };
  assert.match(render(admin, '/', { developmentAdmin: true }), /href="\/dev\/impersonation"[^>]*>Test as user/);
  assert.doesNotMatch(render(admin), /Test as user/);
  const sales = { name: 'Ryan Example', role: 'SALES', canManageUsers: false };
  const html = render(sales, '/accounts', { impersonating: { realName: 'Chad Admin', effectiveName: 'Ryan Example', role: 'SALES' } });
  assert.match(html, /Development mode.*Testing as Ryan Example/);
  assert.match(html, /Return to Admin/);
  assert.doesNotMatch(html, /href="\/administration"|href="\/integrations"|href="\/dev\/impersonation"/);
});

test('authenticated shell shows only the logo in its brand area and keeps user controls', () => {
  const roles = { ADMIN: 'Administrator', SALES_MANAGER: 'Sales Manager', SALES: 'Sales', MARKETING_MANAGER: 'Marketing Manager', READ_ONLY: 'Read Only' };
  for (const [role, label] of Object.entries(roles)) {
    const html = render({ name: 'Chad Guenther', role, canManageUsers: role === 'ADMIN' });
    assert.match(html, /Chad Guenther/);
    assert.match(html, /src="\/brand\/bixolon-logo\.png" alt="BIXOLON"/);
    assert.match(html, /<nav[^>]*>.*>CRM<\/p>/);
    assert.doesNotMatch(html, /BIXOLON America CRM|bg-orange-600/);
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

test('Marketing Audience navigation follows the Admin and Marketing role grants', () => {
  for (const role of ['ADMIN','MARKETING_MANAGER','SALES_MANAGER','SALES','READ_ONLY']) {
    const html = render({ name: 'Test User', role, canViewMarketing: can({ id: 7, role, active: true, archivedAt: null }, 'marketing.read') });
    assert.equal(html.includes('href="/marketing/audiences"'), ['ADMIN','MARKETING_MANAGER'].includes(role));
    assert.match(html, /href="\/trade-shows"/);
  }
});

test('navigation groups preserve role visibility and Admin-only Demos', () => {
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES', 'MARKETING_MANAGER', 'READ_ONLY']) {
    const actor = { id: 7, role, active: true, archivedAt: null };
    const html = render({ name: 'Test User', role, canManageUsers: role === 'ADMIN', canViewReports: can(actor, 'reports.view'), canViewMarketing: can(actor, 'marketing.read'), canViewSales: can(actor, 'sales.read') });
    for (const section of ['CRM', 'Sales', 'Programs', 'Catalog']) assert.match(html, new RegExp(`>${section}</p>`));
    assert.equal(html.includes('>Admin</p>'), role === 'ADMIN');
    assert.equal(html.includes('href="/demos"'), role === 'ADMIN');
    assert.equal(html.includes('href="/administration"'), role === 'ADMIN');
    assert.equal(html.includes('href="/marketing/audiences"'), can(actor, 'marketing.read'));
    assert.equal(html.includes('href="/reports"'), can(actor, 'reports.view'));
  }
});

test('Pipeline navigation matches existing route permission for every role', () => {
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES', 'MARKETING_MANAGER', 'READ_ONLY']) {
    const actor = { id: 7, role, active: true, archivedAt: null };
    const allowed = can(actor, 'sales.read');
    const html = render({ name: 'Test User', role, canViewSales: allowed });
    assert.equal(html.includes('href="/pipeline"'), allowed, role);
    assert.equal(routeAccess('/pipeline', actor), allowed ? 'allowed' : 'denied', role);
  }
  assert.equal(routeAccess('/pipeline', { id: 7, role: 'MARKETING_MANAGER', active: true, archivedAt: null }), 'denied');
});

test('Pipeline navigation uses the effective Marketing Manager during impersonation', async () => {
  const real = { id: 1, role: 'ADMIN', active: true, name: 'Admin', email: 'admin@example.test' };
  const db = { user: { findUnique: async () => ({ id: 7, role: 'MARKETING_MANAGER', active: true, archivedAt: null, firstName: 'Marketing', lastName: 'Manager', email: 'marketing@example.test' }) } };
  const context = await resolveUserContext(real, '7', db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  assert.equal(context.impersonating, true);
  assert.equal(can(context.real, 'sales.read'), true);
  const html = render({ name: context.effective.name, role: context.effective.role, canViewSales: can(context.effective, 'sales.read') }, '/', { impersonating: { realName: real.name, effectiveName: context.effective.name, role: context.effective.role } });
  assert.doesNotMatch(html, /href="\/pipeline"/);
  assert.match(html, /Testing as Marketing Manager/);
});
