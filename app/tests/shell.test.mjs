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
  if (request === './notification-bell') return { NotificationBell: () => React.createElement('span', null, 'Notifications') };
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

const expectedSections = {
  CRM: ['/', '/accounts', '/contacts'],
  Sales: ['/opportunities', '/pipeline', '/sales-plan', '/tasks', '/calendar-matches', '/demos'],
  Support: ['/support/cases'],
  Programs: ['/projects'],
  Marketing: ['/trade-shows', '/marketing/campaigns', '/marketing/audiences'],
  'Catalog & Pricing': ['/products', '/price-exceptions'],
  Reports: ['/reports'],
  Administration: ['/administration', '/integrations'],
};

function shellUser(role) {
  const actor = { id: 7, role, active: true, archivedAt: null };
  return { name: 'Test User', role, canManageUsers: can(actor, 'users.manage'), canViewReports: can(actor, 'sales.read') || can(actor, 'trade-shows.read'), canViewMarketing: can(actor, 'marketing.read'), canViewSales: can(actor, 'sales.read'), canViewOpportunities: can(actor, 'opportunities.read'), canViewSupport: can(actor, 'support-cases.read') && can(actor, 'accounts.read') };
}

function navigation(html) {
  const nav = html.match(/<nav aria-label="Primary navigation"[^>]*>(.*?)<\/nav>/)?.[1] ?? '';
  const headings = [...nav.matchAll(/<p[^>]*>([^<]+)<\/p>/g)];
  return Object.fromEntries(headings.map((heading, index) => [heading[1].replaceAll('&amp;', '&'), [...nav.slice(heading.index, headings[index + 1]?.index).matchAll(/<a href="([^"]+)"/g)].map(link => link[1])]));
}

function classesFor(html, tag, attribute = '') {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opening = html.match(new RegExp(`<${tag}(?:\\s[^>]*?)?${escaped}[^>]*>`))?.[0] ?? '';
  return new Set(opening.match(/class="([^"]+)"/)?.[1].split(/\s+/) ?? []);
}

test('desktop shell bounds both panes and gives the navigation independent vertical scrolling', () => {
  for (const role of ['ADMIN', 'SALES', 'MARKETING_MANAGER']) {
    const html = render(shellUser(role), '/', { impersonating: { realName: 'Admin', effectiveName: 'Test User', role } });
    const shell = classesFor(html, 'div');
    const aside = classesFor(html, 'aside');
    const nav = classesFor(html, 'nav', 'aria-label="Primary navigation"');
    assert.ok(shell.has('lg:h-dvh') && shell.has('lg:overflow-hidden'), role);
    assert.ok(!shell.has('lg:h-screen'), `${role}: dynamic viewport height must take precedence`);
    for (const cls of ['lg:flex', 'lg:h-full', 'lg:min-h-0', 'lg:flex-col']) assert.ok(aside.has(cls), `${role}: aside ${cls}`);
    for (const cls of ['lg:min-h-0', 'lg:flex-1', 'lg:overflow-y-auto']) assert.ok(nav.has(cls), `${role}: nav ${cls}`);
    assert.ok(nav.has('overflow-x-auto'), `${role}: mobile horizontal navigation`);
    assert.ok(nav.has('lg:overflow-x-hidden'), `${role}: desktop vertical navigation`);
    assert.match(html, /<div class="min-w-0 flex-1 lg:h-full lg:min-h-0 lg:overflow-y-auto">/);
    assert.match(html, /role="status"/);
  }
  const adminLinks = navigation(render(shellUser('ADMIN'))).Administration;
  assert.deepEqual(adminLinks, ['/administration', '/integrations']);
});

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

test('navigation groups preserve every route once and match effective role access', () => {
  const allRoutes = Object.values(expectedSections).flat();
  assert.equal(new Set(allRoutes).size, allRoutes.length);
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES', 'MARKETING_MANAGER', 'READ_ONLY']) {
    const actor = { id: 7, role, active: true, archivedAt: null };
    const html = render(shellUser(role));
    const actual = navigation(html);
    const expected = Object.fromEntries(Object.entries(expectedSections).map(([section, routes]) => [section, routes.filter(route =>
      (route !== '/demos' || role === 'ADMIN') &&
      (route !== '/opportunities' || can(actor, 'opportunities.read')) &&
      (!['/pipeline', '/sales-plan', '/calendar-matches'].includes(route) || can(actor, route === '/sales-plan' ? 'sales-plan.read' : 'sales.read')) &&
      (route !== '/marketing/audiences' || can(actor, 'marketing.read')) &&
      (!['/administration', '/integrations'].includes(route) || can(actor, route === '/administration' ? 'users.manage' : 'integrations.manage'))
    )]).filter(([, routes]) => routes.length));
    assert.deepEqual(actual, expected, role);
    for (const route of Object.values(actual).flat()) assert.equal(routeAccess(route, actor), 'allowed', `${role}: ${route}`);
  }
  assert.deepEqual(navigation(render(null)), {});
  assert.deepEqual(navigation(render(shellUser('MARKETING_MANAGER'))).Sales, ['/opportunities', '/tasks']);
  assert.deepEqual(navigation(render(shellUser('MARKETING_MANAGER'))).Programs, ['/projects']);
  assert.deepEqual(navigation(render({ name: 'No grants', role: 'MARKETING_MANAGER', canManageUsers: false, canViewReports: false, canViewMarketing: false, canViewSales: false })).Administration, undefined);
});
test('Support navigation shows case work and permitted CRM context', () => {
  const links = Object.values(navigation(render(shellUser('SUPPORT')))).flat();
  assert.deepEqual(links, ['/', '/accounts', '/contacts', '/support/cases', '/products']);
  for (const route of links) assert.equal(routeAccess(route, { id: 7, role: 'SUPPORT', active: true, archivedAt: null }), 'allowed');
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

test('impersonation uses effective Marketing Manager navigation and keeps return control', async () => {
  const real = { id: 1, role: 'ADMIN', active: true, name: 'Admin', email: 'admin@example.test' };
  const db = { user: { findUnique: async () => ({ id: 7, role: 'MARKETING_MANAGER', active: true, archivedAt: null, firstName: 'Marketing', lastName: 'Manager', email: 'marketing@example.test' }) } };
  const context = await resolveUserContext(real, '7', db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  const html = render(shellUser(context.effective.role), '/trade-shows', { impersonating: { realName: real.name, effectiveName: context.effective.name, role: context.effective.role } });
  assert.deepEqual(navigation(html), navigation(render(shellUser('MARKETING_MANAGER'), '/trade-shows')));
  assert.doesNotMatch(html, /href="\/administration"|href="\/integrations"|href="\/pipeline"|href="\/sales-plan"/);
  assert.match(html, /href="\/opportunities"/);
  assert.match(html, /Return to Admin/);
  assert.match(html, /href="\/trade-shows" aria-current="page"/);
});
