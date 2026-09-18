import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL);
assert.match(url.hostname, /^bixolon-foundation-test-[a-f0-9]+-db$/);
assert.equal(url.pathname, '/backfill');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { parseActivity, saveActivity } = require(path.resolve('lib/work.ts'));
const prisma = new PrismaClient();
const form = fields => { const data = new FormData(); for (const [key, value] of fields) data.append(key, value); return data; };
const base = [['subject', 'Rejected new Activity'], ['type', 'CALL'], ['activityDate', '2026-09-18T14:30']];
const value = fields => {
  const parsed = parseActivity(form([...base, ...fields]));
  assert.deepEqual(parsed.errors, {});
  return parsed.value;
};
try {
  const before = await prisma.activity.count();
  await assert.rejects(saveActivity(prisma, value([['accountId', '102'], ['opportunityId', '100']])), /Opportunity is not associated with the selected Account/);
  await assert.rejects(saveActivity(prisma, value([['accountId', '102'], ['projectId', '1000']])), /Project is not associated with the selected Account/);
  await prisma.opportunityAccount.create({ data: { opportunityId: 102, accountId: 100 } });
  await assert.rejects(saveActivity(prisma, value([['accountId', '100'], ['opportunityId', '102'], ['projectId', '1000']])), /Project is not linked to the selected Opportunity/);
  await assert.rejects(saveActivity(prisma, value([['accountId', '101'], ['contactIds', '100']])), /Contact is not associated with the selected Account/);
  assert.equal(await prisma.activity.count(), before);
  const historical = await prisma.activity.findUnique({ where: { id: 102 }, include: { account: true, opportunity: true } });
  assert.equal(historical.accountId, 102);
  assert.equal(historical.opportunityId, 100);
  assert.equal(historical.account.id, 102);
  assert.equal(historical.opportunity.id, 100);
  console.log('PASS: migrated database rejects invalid new Account, Project, OpportunityProject, and Contact relationships through saveActivity; historical Activity remains readable');
} finally {
  await prisma.$disconnect();
}
