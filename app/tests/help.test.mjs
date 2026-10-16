import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
const require = Module.createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { helpTopics, visibleHelpTopics, helpGroups } = require('../lib/help/topics.ts');
const { helpHref } = require('../lib/help/links.ts');
const { can, routeAccess } = require('../lib/authorization.ts');
const actor = role => ({ id: 7, role, active: true });
const ids = role => visibleHelpTopics(actor(role)).map(topic => topic.id);
const adminOnly = ['data-quality', 'ownership-reassignment', 'system-health', 'audit-history', 'maintenance-history'];

test('Help visibility follows the effective actor and existing read/write checks for all roles', () => {
  assert.deepEqual(new Set(ids('ADMIN')), new Set(Object.keys(helpTopics)));
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES', 'SUPPORT', 'MARKETING_MANAGER', 'READ_ONLY']) {
    const user = actor(role), topics = visibleHelpTopics(user);
    assert.ok(topics.some(topic => topic.id === 'getting-started'));
    for (const id of adminOnly) assert.equal(ids(role).includes(id), can(user, 'users.manage'), `${role}: ${id}`);
    for (const id of ['support-inbox', 'log-email-response']) assert.equal(ids(role).includes(id), can(user, 'support-cases.write'));
    for (const id of ['forecast-snapshots', 'opportunity-snapshots']) assert.equal(ids(role).includes(id), routeAccess('/reports/opportunity-snapshots', user) === 'allowed');
    assert.equal(ids(role).includes('marketing-attribution'), can(user, 'marketing.read'));
    for (const topic of topics) for (const section of topic.sections) if (section.permission) assert.equal(can(user, section.permission), true);
  }
  assert.ok(!ids('SUPPORT').includes('opportunities'));
  assert.ok(!ids('SUPPORT').includes('price-exceptions'));
  for (const user of [{ ...actor('ADMIN'), active: false }, { ...actor('ADMIN'), archivedAt: new Date() }]) assert.deepEqual(visibleHelpTopics(user), []);
});

test('Read Only receives viewing guidance without action-only sections or Administration', () => {
  const topics = visibleHelpTopics(actor('READ_ONLY'));
  assert.ok(!topics.some(topic => topic.group === 'Administration'));
  assert.ok(!topics.some(topic => topic.id === 'bulk-actions'));
  assert.ok(topics.some(topic => topic.id === 'support-cases'));
  assert.ok(!topics.flatMap(topic => topic.sections).some(section => section.permission?.endsWith('.write') || section.permission === 'users.manage'));
  assert.ok(!topics.find(topic => topic.id === 'trade-shows').sections.some(section => section.heading === 'Follow through'));
  assert.ok(!topics.find(topic => topic.id === 'getting-started').sections.some(section => section.heading === 'New and Quick Actions'));
});

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(path.join(dir, entry.name)) : /\.tsx$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
test('all literal contextual Help links resolve to published stable topic IDs', () => {
  const files = [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'components'))];
  const ids = files.flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(/<HelpLink topic="([a-z-]+)"/g)].map(match => match[1]));
  for (const id of ids) {
    assert.ok(Object.hasOwn(helpTopics, id), id);
    assert.equal(helpHref(id), `/help/${id}`);
  }
  for (const id of ['forecast-categories', 'opportunity-snapshots', 'forecast-snapshots', 'support-inbox', 'log-email-response', 'price-exceptions', 'bulk-actions']) assert.ok(ids.includes(id), id);
  assert.ok(fs.existsSync(path.join(root, 'app/help/[topic]/page.tsx')));
});

test('guide copy has unique titles, valid groups, concise paragraphs and no internal terminology', () => {
  assert.equal(new Set(Object.values(helpTopics).map(topic => topic.title)).size, Object.keys(helpTopics).length);
  for (const [id, topic] of Object.entries(helpTopics)) {
    assert.match(id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(helpGroups.includes(topic.group));
    for (const section of topic.sections) for (const paragraph of section.paragraphs) {
      assert.ok(paragraph.length < 650, `${id}: split long paragraph`);
      assert.doesNotMatch(paragraph, /\b(immutable|rollup|schema|entity graph|orchestration|normalization|persistence|utilize|seamlessly|robust|leverage)\b/i, id);
    }
  }
});
