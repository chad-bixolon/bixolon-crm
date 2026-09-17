// Exercise lookup administration and Account choices in one rollback-only transaction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';

Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const load = (name) => Module.createRequire(import.meta.url)(path.resolve('lib', name));
const { saveLookup, listLookups } = load('lookups.ts');
const { accountOptions, checkAccountReferences } = load('accounts.ts');
const client = new PrismaClient();
const nonce = Date.now().toString(36);
const industry = `verify_industry_${nonce}`;
const territory = `verify_territory_${nonce}`;
const rollback = new Error('verification rollback');

try {
  await client.$transaction(async (tx) => {
    const account = await tx.account.findFirst({ select: { id: true } });
    assert.ok(account, 'an existing Account is required');
    await saveLookup(tx, 'industries', { code: industry, name: industry, active: true, sortOrder: 9 }, false);
    await saveLookup(tx, 'territories', { code: territory, name: territory, active: true, sortOrder: 9 }, false);
    assert.ok((await listLookups(tx, 'industries')).some((v) => v.code === industry));
    assert.ok((await listLookups(tx, 'territories')).some((v) => v.code === territory));
    let options = await accountOptions(tx);
    assert.ok(options.industries.some((v) => v.code === industry));
    assert.ok(options.territories.some((v) => v.code === territory));
    await saveLookup(tx, 'industries', { code: industry, name: `${industry}_edited`, active: true, sortOrder: 2 }, true);
    await saveLookup(tx, 'territories', { code: territory, name: `${territory}_edited`, active: true, sortOrder: 2 }, true);
    assert.equal((await tx.industry.findUnique({ where: { code: industry } })).sortOrder, 2);
    assert.equal((await tx.territory.findUnique({ where: { code: territory } })).sortOrder, 2);
    await tx.account.update({ where: { id: account.id }, data: { industry, territory } });
    await saveLookup(tx, 'industries', { code: industry, name: `${industry}_edited`, active: false, sortOrder: 2 }, true);
    await saveLookup(tx, 'territories', { code: territory, name: `${territory}_edited`, active: false, sortOrder: 2 }, true);
    options = await accountOptions(tx);
    assert.ok(!options.industries.some((v) => v.code === industry));
    assert.ok(!options.territories.some((v) => v.code === territory));
    const existing = await tx.account.findUnique({ where: { id: account.id }, include: { industryCategory: true, territoryCategory: true } });
    assert.equal(existing.industryCategory.name, `${industry}_edited`);
    assert.equal(existing.territoryCategory.name, `${territory}_edited`);
    assert.deepEqual(await checkAccountReferences(tx, { industry, territory, ownerId: null }, account.id), {});
    assert.deepEqual(await checkAccountReferences(tx, { industry, territory, ownerId: null }), {
      industry: 'Choose an active industry.', territory: 'Choose an active territory.',
    });
    throw rollback;
  }, { timeout: 20000 });
  throw new Error('verification transaction unexpectedly committed');
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  assert.equal(await client.industry.findUnique({ where: { code: industry } }), null);
  assert.equal(await client.territory.findUnique({ where: { code: territory } }), null);
  await client.$disconnect();
}
console.log('PASS: Industry and Territory create, edit, deactivate, Account active choices, and existing inactive selections; transaction rolled back.');
