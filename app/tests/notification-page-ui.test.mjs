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
const require = Module.createRequire(import.meta.url);
const originalLoad = Module._load;
const originalTsx = Module._extensions['.tsx'];
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
let availability = { canMarkAllRead: false, canDismissRead: false };
let requested;
const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
Module._load = function(specifier, parent, isMain) {
  if (specifier === 'next/link') return function MockLink({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (specifier === '@/components/shell') return {
    Content: ({ children }) => React.createElement('main', null, children),
    PageHeader: ({ eyebrow, title, description, action }) => React.createElement('header', null, React.createElement('p', null, eyebrow), React.createElement('h1', null, title), React.createElement('p', null, description), action),
  };
  if (specifier === '@/components/notification-items') return { NotificationItems: ({ rows }) => React.createElement('div', null, `${rows.length} notifications`) };
  if (specifier === './actions') return { markAllRead: async () => {}, dismissAllRead: async () => {} };
  if (specifier === '@/lib/current-user') return { currentUser: async () => actor };
  if (specifier === '@/lib/prisma') return { prisma: {} };
  if (specifier === '@/lib/notifications') return {
    notificationViews: ['active', 'unread', 'all', 'dismissed', 'resolved'],
    notificationCategories: ['all', 'price-exceptions', 'tasks', 'opportunities', 'support'],
    notificationBulkActionAvailability: async () => availability,
    notificationPage: async (_db, _actor, ...args) => { requested = args; return { rows: [], page: 1, pages: 1 }; },
  };
  return originalLoad.call(this, specifier, parent, isMain);
};
const NotificationsPage = require(path.join(root, 'app/notifications/page.tsx')).default;
Module._load = originalLoad;
Module._extensions['.tsx'] = originalTsx;

const render = async params => renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve(params) }));

test('Notification Center groups server filters and uses polished wording', async () => {
  const html = await render({ view: 'active' });
  assert.match(html, /<p>Notifications<\/p><h1>Notification Center<\/h1>/);
  assert.match(html, /Stay on top of tasks, opportunities, price exceptions, and Support Cases that need your attention\./);
  assert.match(html, /aria-label="Notification filters"/);
  assert.match(html, />Status<\/h2>.*aria-label="Notification state"/);
  assert.match(html, />Category<\/h2>.*aria-label="Notification category"/);
  assert.match(html, />History<\/a>/);
  assert.doesNotMatch(html, /All \/ History|Personal attention queue|Dismiss all read/);
  assert.match(html, /All severities<\/option>/);
  assert.match(html, /<button class="btn-primary"[^>]*>Apply<\/button>/);
  assert.match(html, /aria-current="page"[^>]*>.*?✓.*?Active<\/a>/);
  assert.match(html, /No active notifications<\/h2><p[^>]*>You don&#x27;t have anything requiring attention right now\./);
  assert.deepEqual(requested, ['active', 1, 20, 'all', undefined]);
});

test('bulk actions reflect eligible state, and selected filters preserve server parameters', async () => {
  availability = { canMarkAllRead: true, canDismissRead: false };
  const html = await render({ view: 'unread', category: 'tasks', severity: 'WARNING', page: '2' });
  assert.match(html, /<button class="btn-secondary"[^>]*>Mark all read<\/button>/);
  assert.match(html, /<button class="btn-secondary" disabled=""[^>]*>Dismiss read<\/button>/);
  assert.match(html, /href="\/notifications\?view=unread&amp;category=tasks&amp;severity=WARNING&amp;page=1"[^>]*aria-current="page"/);
  assert.match(html, /name="view" value="unread"/);
  assert.match(html, /name="category" value="tasks"/);
  assert.match(html, /<option value="WARNING" selected="">WARNING<\/option>/);
  assert.match(html, /No unread notifications/);
  assert.deepEqual(requested, ['unread', 2, 20, 'tasks', 'WARNING']);
  availability = { canMarkAllRead: false, canDismissRead: true };
  const readHtml = await render({ view: 'resolved' });
  assert.match(readHtml, /<button class="btn-secondary" disabled=""[^>]*>Mark all read<\/button>/);
  assert.match(readHtml, /<button class="btn-secondary"[^>]*>Dismiss read<\/button>/);
  assert.match(readHtml, /No resolved notifications/);
  assert.match(await render({ view: 'dismissed' }), /No dismissed notifications/);
});
