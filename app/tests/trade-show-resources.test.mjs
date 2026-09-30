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
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { TradeShowResources } = require(path.join(root, 'components/trade-show-resources.tsx'));

test('Show resources displays a compact empty state and safe named links', () => {
  const empty = renderToStaticMarkup(React.createElement(TradeShowResources, { boothNumber: null, links: [] }));
  assert.match(empty, /No show resources added\./);
  const filled = renderToStaticMarkup(React.createElement(TradeShowResources, { boothNumber: 'Hall B — 1427', links: [
    { id: 1, label: 'Floor plan', url: 'https://example.com/plan' },
    { id: 2, label: 'Exhibitor portal', url: 'https://portal.example.com' },
  ] }));
  assert.match(filled, /Booth number.*Hall B — 1427/);
  assert.match(filled, /href="https:\/\/example.com\/plan" target="_blank" rel="noopener noreferrer">Floor plan ↗<\/a>/);
  assert.match(filled, /href="https:\/\/portal.example.com" target="_blank" rel="noopener noreferrer">Exhibitor portal ↗<\/a>/);
  assert.doesNotMatch(filled, /No show resources added/);
});

test('Trade Show detail puts Event and Show resources in natural-height responsive columns', () => {
  const page = fs.readFileSync(path.join(root, 'app/trade-shows/[id]/page.tsx'), 'utf8');
  assert.match(page, /grid min-w-0 items-start gap-5 lg:grid-cols-2/);
  assert.match(page, /<h2 className="mb-4 text-lg font-semibold">Event<\/h2>[\s\S]*<TradeShowResources boothNumber=\{show.boothNumber\} links=\{show.resourceLinks\}/);
  assert.match(page, /resourceLinks: \{ orderBy:/);
  const form = fs.readFileSync(path.join(root, 'components/trade-show-form.tsx'), 'utf8');
  assert.match(form, /name="boothNumber"/);
  assert.match(form, /name="resourceLabel"/);
  assert.match(form, /name="resourceUrl"/);
  assert.match(form, /initial\?\.resourceLinks\.map/);
  assert.match(form, /Add link/);
  assert.match(form, /Remove/);
  const editPage = fs.readFileSync(path.join(root, 'app/trade-shows/[id]/edit/page.tsx'), 'utf8');
  assert.match(editPage, /resourceLinks: \{ orderBy:/);
  assert.match(editPage, /<TradeShowForm id=\{id\} initial=\{show\}/);
});
