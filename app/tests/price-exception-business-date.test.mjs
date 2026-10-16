import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';

const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { businessToday, isPriceExceptionExpired } = require('../lib/price-exception-dates.ts');
const { activePriceExceptionLineWhere } = require('../lib/price-exception-lookup.ts');
const { priceExceptionEligibilityWhere } = require('../lib/opportunity-price-exceptions.ts');
const { expirationWhere } = require('../lib/price-exception-expiration.ts');
const { followUpOverdue } = require('../lib/price-exception-follow-up.ts');
const actor = { id: 1, role: 'ADMIN', active: true };

const boundaries = [
  ['2026-10-16T23:59:59Z', '2026-10-16'],
  ['2026-10-17T00:00:00Z', '2026-10-16'],
  ['2026-10-17T03:59:59Z', '2026-10-16'],
  ['2026-10-17T04:00:00Z', '2026-10-17'],
  ['2026-03-08T04:59:59Z', '2026-03-07'],
  ['2026-03-08T05:00:00Z', '2026-03-08'],
  ['2026-03-08T06:59:59Z', '2026-03-08'],
  ['2026-03-08T07:00:00Z', '2026-03-08'],
  ['2026-03-09T04:00:00Z', '2026-03-09'],
  ['2026-11-01T03:59:59Z', '2026-10-31'],
  ['2026-11-01T04:00:00Z', '2026-11-01'],
  ['2026-11-01T05:30:00Z', '2026-11-01'],
  ['2026-11-01T06:30:00Z', '2026-11-01'],
  ['2026-11-02T04:59:59Z', '2026-11-01'],
  ['2026-11-02T05:00:00Z', '2026-11-02'],
];

for (const [instant, day] of boundaries) test(`PE discovery, selection, reporting and follow-up agree at ${instant}`, () => {
  const now = new Date(instant), today = new Date(`${day}T00:00:00Z`);
  assert.deepEqual(businessToday(now), today);
  const lookup = activePriceExceptionLineWhere(actor, {}, now);
  assert.deepEqual(lookup.priceException.OR[1].expirationDate.gte, today);
  assert.deepEqual(priceExceptionEligibilityWhere(9, 'USD', now).priceException.AND[0].OR[1].expirationDate.gte, today);
  assert.deepEqual(expirationWhere('expired', today), { expirationDate: { lt: today } });
  const yesterday = new Date(today.getTime() - 86400000);
  assert.equal(isPriceExceptionExpired(yesterday, now), true);
  assert.equal(isPriceExceptionExpired(today, now), false);
  assert.equal(isPriceExceptionExpired(null, now), false);
  assert.equal(followUpOverdue(yesterday, 'IN_PROGRESS', today), true);
  assert.equal(followUpOverdue(today, 'IN_PROGRESS', today), false);
  assert.equal(today.toISOString(), `${day}T00:00:00.000Z`);
});
