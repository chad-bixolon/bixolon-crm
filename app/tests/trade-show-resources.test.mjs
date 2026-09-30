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

test('Show resources separates booth and links with a compact empty state', () => {
  const empty = renderToStaticMarkup(React.createElement(TradeShowResources, { boothNumber: null, links: [] }));
  assert.match(empty, /No show resources added\./);
  assert.doesNotMatch(empty, />Links</);
  const filled = renderToStaticMarkup(React.createElement(TradeShowResources, { boothNumber: 'Hall B — 1427', links: [
    { id: 1, label: 'Floor plan', url: 'https://example.com/plan' },
    { id: 2, label: 'Exhibitor portal', url: 'https://portal.example.com' },
  ] }));
  assert.match(filled, /Booth number.*Hall B — 1427.*>Links</);
  assert.match(filled, /href="https:\/\/example.com\/plan" target="_blank" rel="noopener noreferrer"><span[^>]*>Floor plan<\/span><span aria-hidden="true"[^>]*>↗<\/span>/);
  assert.match(filled, /href="https:\/\/portal.example.com" target="_blank" rel="noopener noreferrer"><span[^>]*>Exhibitor portal<\/span><span aria-hidden="true"[^>]*>↗<\/span>/);
  assert.doesNotMatch(filled.replace(/<[^>]*>/g, ''), /https?:\/\//);
  assert.doesNotMatch(filled, /No show resources added/);

  const boothOnly = renderToStaticMarkup(React.createElement(TradeShowResources, { boothNumber: '417', links: [] }));
  assert.match(boothOnly, /Booth number.*417/);
  assert.doesNotMatch(boothOnly, />Links</);
  const linksOnly = renderToStaticMarkup(React.createElement(TradeShowResources, { boothNumber: null, links: [
    { id: 3, label: 'Show', url: 'https://example.com/show' },
    { id: 4, label: 'Booth', url: 'https://example.com/booth' },
  ] }));
  assert.match(linksOnly, />Links<.*>Show<.*>Booth</);
  assert.doesNotMatch(linksOnly, /Booth number/);
});

test('Trade Show detail puts Event and Show resources in natural-height responsive columns', () => {
  const page = fs.readFileSync(path.join(root, 'app/trade-shows/[id]/page.tsx'), 'utf8');
  assert.match(page, /grid min-w-0 items-start gap-5 lg:grid-cols-2/);
  assert.match(page, /<h2 className="mb-4 text-lg font-semibold">Event<\/h2>[\s\S]*<TradeShowResources boothNumber=\{show.boothNumber\} links=\{show.resourceLinks\}/);
  assert.match(page, /resourceLinks: \{ orderBy:/);
  const form = fs.readFileSync(path.join(root, 'components/trade-show-form.tsx'), 'utf8');
  assert.match(form, /name="boothNumber"/);
  assert.match(form, /name="resourceLabel"/);
  assert.match(form, /placeholder="Floor plan, Show website, Exhibitor portal, Shipping instructions"/);
  assert.match(form, /name="resourceUrl"/);
  assert.match(form, /initial\?\.resourceLinks\.map/);
  assert.match(form, /Add link/);
  assert.match(form, /Remove/);
  const editPage = fs.readFileSync(path.join(root, 'app/trade-shows/[id]/edit/page.tsx'), 'utf8');
  assert.match(editPage, /resourceLinks: \{ orderBy:/);
  assert.match(editPage, /<TradeShowForm id=\{id\} initial=\{show\}/);
});
