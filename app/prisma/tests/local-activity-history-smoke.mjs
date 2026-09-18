import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, 'db');
assert.equal(url.pathname, '/bixolon_crm');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { parseActivity, saveActivity } = require(path.resolve('lib/work.ts'));
const { activityChoices } = require(path.resolve('lib/activity-relations.ts'));
const prisma = new PrismaClient();
const rollback = new Error('ROLLBACK_STAGE3_LOCAL_SMOKE');
const form = fields => { const data = new FormData(); for (const [key, value] of fields) data.append(key, String(value)); return data; };
const parse = fields => {
  const parsed = parseActivity(form(fields));
  assert.deepEqual(parsed.errors, {});
  return parsed.value;
};

try {
  await assert.rejects(prisma.$transaction(async tx => {
    const stage = await tx.salesStage.findFirst({ where: { active: true }, select: { id: true } });
    const type = await tx.activityType.findFirst({ where: { active: true }, select: { code: true } });
    assert.ok(stage && type, 'Active stage and Activity type are required for smoke test');
    const user = await tx.user.create({ data: { email: `stage3-smoke-${Date.now()}@example.invalid`, firstName: 'Stage', lastName: 'Three' } });
    const account = await tx.account.create({ data: { name: 'Stage 3 smoke Account' } });
    const otherAccount = await tx.account.create({ data: { name: 'Stage 3 smoke unrelated Account' } });
    const opportunity = await tx.opportunity.create({ data: { name: 'Stage 3 smoke Opportunity', stageId: stage.id } });
    const otherOpportunity = await tx.opportunity.create({ data: { name: 'Stage 3 smoke unlinked Opportunity', stageId: stage.id } });
    await tx.opportunityAccount.create({ data: { opportunityId: opportunity.id, accountId: account.id } });
    await tx.opportunityAccount.create({ data: { opportunityId: otherOpportunity.id, accountId: account.id } });
    const project = await tx.project.create({ data: { name: 'Stage 3 smoke Project', primaryAccountId: account.id, primaryAccountRole: 'PROGRAM_OWNER', createdById: user.id } });
    await tx.opportunityProject.create({ data: { opportunityId: opportunity.id, projectId: project.id } });
    const contact = await tx.contact.create({ data: { accountId: account.id, firstName: 'Valid', lastName: 'Contact' } });
    const otherContact = await tx.contact.create({ data: { accountId: otherAccount.id, firstName: 'Unrelated', lastName: 'Contact' } });
    const adapter = { $transaction: fn => fn(tx) };
    const base = [['subject', 'Stage 3 smoke Activity'], ['type', type.code], ['activityDate', '2026-09-18T14:30']];
    const valid = parse([...base, ['accountId', account.id], ['opportunityId', opportunity.id], ['projectId', project.id], ['contactIds', contact.id]]);
    const created = await saveActivity(adapter, valid);
    assert.equal((await tx.activityContact.count({ where: { activityId: created.id, contactId: contact.id } })), 1);
    await assert.rejects(saveActivity(adapter, parse([...base, ['accountId', otherAccount.id], ['opportunityId', opportunity.id]])), /Opportunity is not associated/);
    await assert.rejects(saveActivity(adapter, parse([...base, ['accountId', otherAccount.id], ['projectId', project.id]])), /Project is not associated/);
    await assert.rejects(saveActivity(adapter, parse([...base, ['accountId', account.id], ['opportunityId', otherOpportunity.id], ['projectId', project.id]])), /Project is not linked/);
    await assert.rejects(saveActivity(adapter, parse([...base, ['accountId', account.id], ['contactIds', otherContact.id]])), /Contact is not associated/);
    await tx.opportunityAccount.delete({ where: { opportunityId_accountId: { opportunityId: opportunity.id, accountId: account.id } } });
    const historical = await tx.activity.findUnique({ where: { id: created.id }, include: { account: true, opportunity: true, project: true, contacts: { include: { contact: true } } } });
    assert.equal(historical.account.id, account.id);
    assert.equal(historical.opportunity.id, opportunity.id);
    assert.equal(historical.project.id, project.id);
    assert.equal(historical.contacts[0].contact.id, contact.id);
    const choices = activityChoices(account.id, account.id,
      [{ id: opportunity.id, name: opportunity.name, accountIds: [], projectIds: [project.id] }],
      [{ id: project.id, name: project.name, accountIds: [account.id], opportunityIds: [opportunity.id] }],
      [{ id: contact.id, name: 'Valid Contact', accountId: account.id, active: true }],
      { opportunityId: opportunity.id, projectId: project.id, contactIds: [contact.id] },
      { opportunityId: opportunity.id, projectId: project.id });
    assert.equal(choices.opportunities[0].id, opportunity.id);
    const edited = await saveActivity(adapter, { ...valid, subject: 'Stage 3 historical edit' }, created.id);
    assert.equal(edited.subject, 'Stage 3 historical edit');
    assert.equal(edited.accountId, account.id);
    assert.equal(edited.opportunityId, opportunity.id);
    assert.equal(edited.projectId, project.id);
    console.log('PASS: valid Activity saved; four invalid relationships rejected; participant removed; historical Activity loaded and edited without changing relationships');
    throw rollback;
  }, { timeout: 60000 }), error => error === rollback);
  console.log('PASS: smoke transaction rolled back all synthetic records');
} finally {
  await prisma.$disconnect();
}
