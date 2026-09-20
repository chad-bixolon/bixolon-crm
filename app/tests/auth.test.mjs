import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { can, routeAccess, opportunityScope, taskScope } = require(path.join(root, 'lib/authorization.ts'));
const { resolveGoogleIdentity, resolveLinkedSession, GOOGLE_ISSUER } = require(path.join(root, 'lib/identity.ts'));
const { parseUser, saveUser, unlinkGoogleIdentity } = require(path.join(root, 'lib/users.ts'));
const { parseTask, saveTask, parseNote, saveNote } = require(path.join(root, 'lib/work.ts'));
const actor = (role) => ({ id: 7, role, active: true, archivedAt: null });
const form = (entries) => { const result = new FormData(); for (const [key,value] of entries) result.append(key,value); return result; };
const googleProfile = { sub: 'stable-google-subject', iss: GOOGLE_ISSUER, hd: 'bixolon.example', email: 'approved@bixolon.example', email_verified: true };
function identityFixture({ user = { ...actor('SALES'), email: googleProfile.email }, identity = null } = {}) {
  const state = { user, identity, lookups: [], creates: [], userCreates: 0 };
  const client = {
    user: {
      findUnique: async ({ where }) => { state.lookups.push(where); return state.user?.email === where.email ? state.user : null; },
      create: async () => { state.userCreates++; throw new Error('CRM user must never be created'); },
    },
    externalIdentity: {
      findUnique: async ({ where }) => { assert.deepEqual(where.issuer_subject, { issuer: GOOGLE_ISSUER, subject: googleProfile.sub }); return state.identity; },
      create: async ({ data }) => { state.creates.push(data); state.identity = { id: 21, provider: data.provider, issuer: data.issuer, subject: data.subject, user: state.user }; return state.identity; },
    },
  };
  return { client, state };
}
test('first login links a pre-created active CRM user and preserves its role', async () => {
  const { client, state } = identityFixture({ user: { ...actor('MARKETING_MANAGER'), email: googleProfile.email } });
  const result = await resolveGoogleIdentity(client, googleProfile, 'bixolon.example');
  assert.equal(result.user.id, 7);
  assert.equal(result.user.role, 'MARKETING_MANAGER');
  assert.equal(result.identityId, 21);
  assert.deepEqual(state.lookups, [{ email: googleProfile.email }]);
  assert.deepEqual(state.creates, [{ provider: 'GOOGLE', issuer: GOOGLE_ISSUER, subject: googleProfile.sub, userId: 7 }]);
  assert.equal(state.userCreates, 0);
});
test('subsequent login resolves by issuer and subject, even after email changes', async () => {
  const { client, state } = identityFixture();
  await resolveGoogleIdentity(client, googleProfile, 'bixolon.example');
  state.lookups.length = 0;
  const result = await resolveGoogleIdentity(client, { ...googleProfile, email: 'renamed@bixolon.example' }, 'bixolon.example');
  assert.equal(result.user.id, 7);
  assert.equal(state.creates.length, 1);
  assert.deepEqual(state.lookups, []);
});
test('matching email with inactive CRM user is rejected without linking', async () => {
  const { client, state } = identityFixture({ user: { ...actor('SALES'), active: false, email: googleProfile.email } });
  assert.equal((await resolveGoogleIdentity(client, googleProfile, 'bixolon.example')).reason, 'inactive');
  assert.equal(state.creates.length, 0);
});
test('unknown Workspace user is denied without creating a CRM user or identity', async () => {
  const { client, state } = identityFixture({ user: null });
  assert.equal((await resolveGoogleIdentity(client, googleProfile, 'bixolon.example')).reason, 'unapproved');
  assert.equal(state.creates.length, 0);
  assert.equal(state.userCreates, 0);
});
test('wrong or missing Workspace domain is rejected before database lookup', async () => {
  const { client, state } = identityFixture();
  assert.equal((await resolveGoogleIdentity(client, { ...googleProfile, hd: 'other.example' }, 'bixolon.example')).reason, 'workspace');
  assert.equal((await resolveGoogleIdentity(client, googleProfile)).reason, 'workspace');
  assert.deepEqual(state.lookups, []);
  assert.equal(state.creates.length, 0);
});
test('unverified Google email is rejected before database lookup', async () => {
  const { client, state } = identityFixture();
  assert.equal((await resolveGoogleIdentity(client, { ...googleProfile, email_verified: false }, 'bixolon.example')).reason, 'invalid');
  assert.deepEqual(state.lookups, []);
  assert.equal(state.creates.length, 0);
});
test('existing identity stays linked to its original CRM user', async () => {
  const linked = { ...actor('ADMIN'), id: 8, email: 'original@bixolon.example' };
  const { client, state } = identityFixture({ user: { ...actor('SALES'), email: googleProfile.email }, identity: { id: 22, provider: 'GOOGLE', user: linked } });
  const result = await resolveGoogleIdentity(client, googleProfile, 'bixolon.example');
  assert.equal(result.user.id, 8);
  assert.equal(result.identityId, 22);
  assert.deepEqual(state.lookups, []);
  assert.equal(state.creates.length, 0);
  state.identity.user.active = false;
  assert.equal((await resolveGoogleIdentity(client, googleProfile, 'bixolon.example')).reason, 'inactive');
});
test('ADMIN can pre-create and edit a CRM user without creating an identity', async () => {
  const parsed = parseUser(form([['firstName','Test'],['lastName','User'],['email','TEST@BIXOLON.EXAMPLE'],['role','SALES'],['active','true']]));
  assert.deepEqual(parsed.errors, {});
  assert.equal(parsed.value.email, 'test@bixolon.example');
  let user;
  const client = { user: {
    create: async ({ data }) => { user = { id: 7, archivedAt: null, ...data }; return user; },
    findUnique: async () => user,
    update: async ({ data }) => { user = { ...user, ...data }; return user; },
  } };
  assert.equal(await saveUser(client, parsed.value), 7);
  assert.equal(user.role, 'SALES');
  assert.equal(await saveUser(client, { ...parsed.value, role: 'SALES_MANAGER', active: false }, 7), 7);
  assert.equal(user.role, 'SALES_MANAGER');
  assert.equal(user.active, false);
});
test('reset requires exact CRM email and deletes only the selected Google link', async () => {
  let deleted = 0;
  const client = {
    user: { findUnique: async () => ({ email: 'approved@bixolon.example' }) },
    externalIdentity: { deleteMany: async ({ where }) => { assert.deepEqual(where, { id: 21, userId: 7, provider: 'GOOGLE' }); deleted++; return { count: 1 }; } },
  };
  await assert.rejects(unlinkGoogleIdentity(client, 7, 21, 'other@bixolon.example'), /exact CRM email/);
  assert.equal(deleted, 0);
  await unlinkGoogleIdentity(client, 7, 21, 'approved@bixolon.example');
  assert.equal(deleted, 1);
});
test('removed identity invalidates its existing signed session', async () => {
  let linked = true;
  const client = {
    externalIdentity: { findUnique: async ({ where }) => where.id === 21 && linked ? { userId: 7, provider: 'GOOGLE' } : null },
    user: { findUnique: async () => ({ ...actor('SALES'), email: googleProfile.email }) },
  };
  assert.equal((await resolveLinkedSession(client, 7, 21)).id, 7);
  linked = false;
  assert.equal(await resolveLinkedSession(client, 7, 21), null);
  linked = true;
  assert.equal(await resolveLinkedSession(client, 7, 20), null);
});
test('unique user/provider collision cannot relink an already linked CRM user', async () => {
  const { client, state } = identityFixture();
  client.externalIdentity.create = async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); };
  assert.equal((await resolveGoogleIdentity(client, googleProfile, 'bixolon.example')).reason, 'unapproved');
  assert.equal(state.identity, null);
});
test('roles deny read-only mutations while all active roles can read finalized pricing records', () => {
  for (const role of ['ADMIN','SALES_MANAGER','SALES','MARKETING_MANAGER','READ_ONLY']) assert.equal(can(actor(role),'accounts.read'), true);
  assert.equal(can(actor('READ_ONLY'),'accounts.write'), false);
  assert.equal(can(actor('READ_ONLY'),'tasks.write'), false);
  assert.equal(can(actor('MARKETING_MANAGER'),'pricing.read'), true);
  assert.equal(can(actor('READ_ONLY'),'pricing.read'), true);
  assert.equal(can(actor('MARKETING_MANAGER'),'users.manage'), false);
  assert.equal(can(actor('ADMIN'),'users.manage'), true);
  assert.equal(can({ ...actor('ADMIN'), active: false },'users.manage'), false);
});
test('protected routes allow only authenticated authorized users', () => {
  assert.equal(routeAccess('/accounts', null), 'sign-in');
  assert.equal(routeAccess('/api/health', null), 'allowed');
  assert.equal(routeAccess('/sign-in', null), 'allowed');
  assert.equal(routeAccess('/brand/bixolon-logo.png', null), 'allowed');
  assert.equal(routeAccess('/accounts/new', actor('READ_ONLY')), 'denied');
  assert.equal(routeAccess('/administration/users', actor('SALES_MANAGER')), 'denied');
  assert.equal(routeAccess('/pipeline', actor('MARKETING_MANAGER')), 'denied');
  assert.equal(routeAccess('/accounts', actor('MARKETING_MANAGER')), 'allowed');
});
test('Sales dashboard scope selects own opportunities and tasks', () => {
  assert.deepEqual(opportunityScope(actor('SALES')), { ownerId: 7 });
  assert.deepEqual(taskScope(actor('SALES')), { assignedToId: 7 });
  assert.deepEqual(opportunityScope(actor('SALES_MANAGER')), {});
  assert.deepEqual(taskScope(actor('ADMIN')), {});
});
test('task and note authorship uses authenticated actor', async () => {
  const taskInput = parseTask(form([['subject','Follow up'],['status','OPEN'],['priority','NORMAL']])).value;
  let taskData;
  const taskClient = { $transaction: async fn => fn({ task: { create: async ({data}) => { taskData=data; return {id:1,...data}; } } }) };
  await saveTask(taskClient, taskInput, undefined, undefined, 7);
  assert.equal(taskData.createdById, 7); assert.equal(taskData.updatedById, 7);
  const noteInput = parseNote(form([['body','Call summary'],['accountId','1'],['createdById','999']])).value;
  const noteClient = { $transaction: async fn => fn({ account: {findFirst:async()=>({id:1})},note:{create:async({data})=>data} }) };
  const note = await saveNote(noteClient, noteInput, undefined, 7);
  assert.equal(note.createdById, 7);
});
