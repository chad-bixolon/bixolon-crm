// Authenticated live verification. Restores prior configuration values in finally.
import assert from 'node:assert/strict';
import { encode } from 'next-auth/jwt';
import { PrismaClient } from '@prisma/client';

const client = new PrismaClient();
const base = process.env.AUTH_URL ?? 'http://localhost:3000';
const cookieName = base.startsWith('https:') ? '__Secure-authjs.session-token' : 'authjs.session-token';
const admin = await client.user.findFirst({ where: { role: 'ADMIN', active: true, archivedAt: null, identities: { some: {} } }, select: { id: true, identities: { select: { id: true }, take: 1 } } });
let nonAdmin = await client.user.findFirst({ where: { role: { not: 'ADMIN' }, active: true, archivedAt: null, identities: { some: {} } }, select: { id: true, identities: { select: { id: true }, take: 1 } } });
let temporaryUserId = null;
assert.ok(admin, 'an active linked admin is required');
async function cookieFor(user) {
  const token = await encode({ token: { crmUserId: user.id, crmIdentityId: user.identities[0].id }, secret: process.env.AUTH_SECRET, salt: cookieName, maxAge: 120 });
  return `${cookieName}=${token}`;
}
const adminCookie = await cookieFor(admin);
async function page(path, cookie = adminCookie) {
  const response = await fetch(new URL(path, base), { headers: { Cookie: cookie }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  return { status: response.status, location: response.headers.get('location'), body: await response.text() };
}
const decode = value => value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function forms(html) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(match => ({ tag: match[1], body: match[2] }));
}
function actionData(form, fields = {}) {
  const data = new FormData();
  for (const match of form.body.matchAll(/<input\b([^>]*)\/?\s*>/g)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:$-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
    if (attributes.name && (attributes.type === 'hidden' || attributes.name.startsWith('$ACTION_'))) data.append(attributes.name, attributes.value ?? '');
  }
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  assert.ok([...data.keys()].some(key => key.startsWith('$ACTION_')), 'server action fields missing');
  return data;
}
async function submit(path, form, fields = {}) {
  try {
    const response = await fetch(new URL(path, base), { method: 'POST', headers: { Cookie: adminCookie, Origin: new URL(base).origin }, body: actionData(form, fields), redirect: 'manual', signal: AbortSignal.timeout(8000) });
    assert.ok(response.status === 200 || response.status === 303, `POST ${path} returned ${response.status}`);
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error;
  }
}
async function waitFor(read, expected) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await read() === expected) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(await read(), expected, 'submitted value was not persisted');
}
const saved = { label: null, settings: [] };
try {
  if (!nonAdmin) {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const temporary = await client.user.create({ data: { email: `verify-${nonce}@example.invalid`, firstName: 'Verification', lastName: 'Read Only', role: 'READ_ONLY', active: true } });
    temporaryUserId = temporary.id;
    const identity = await client.externalIdentity.create({ data: { userId: temporary.id, provider: 'GOOGLE', issuer: 'verification.invalid', subject: nonce } });
    nonAdmin = { id: temporary.id, identities: [{ id: identity.id }] };
  }
  const nonAdminCookie = await cookieFor(nonAdmin);
  for (const [path, title] of [['/administration/labels', 'Labels &amp; Terminology'], ['/administration/settings', 'System Settings'], ['/administration/sales-stages', 'Sales Stages'], ['/administration/lookups/activity-types', 'Activity Type values']]) {
    const result = await page(path);
    assert.equal(result.status, 200, `${path} returned ${result.status}`);
    assert.ok(result.body.includes(title), `${path} title missing`);
    console.log(`PASS: ${path} loads for ADMIN.`);
    const denied = await page(path, nonAdminCookie);
    assert.ok(denied.status === 403 || (denied.status >= 300 && denied.status < 400 && denied.location?.includes('access-denied')), `${path} allowed non-ADMIN: ${denied.status}`);
    console.log(`PASS: ${path} denies non-ADMIN.`);
  }
  saved.label = await client.terminologyLabel.findUnique({ where: { key: 'END_USER' } });
  const originalLabel = saved.label?.displayLabel ?? 'End User';
  const marker = `Verified End User ${Date.now()}`;
  const labelForms = forms((await page('/administration/labels')).body);
  const saveIndex = labelForms.findIndex(form => form.tag.includes('id="label-END_USER"'));
  assert.ok(saveIndex >= 0, 'END_USER save form missing');
  await submit('/administration/labels', labelForms[saveIndex], { displayLabel: marker });
  await waitFor(async () => (await client.terminologyLabel.findUnique({ where: { key: 'END_USER' } }))?.displayLabel, marker);
  const labelRow = await client.terminologyLabel.findUnique({ where: { key: 'END_USER' } });
  assert.equal(labelRow.displayLabel, marker);
  assert.equal(labelRow.key, 'END_USER');
  const accountForm = (await page('/accounts/new')).body;
  assert.ok(accountForm.includes(`value="END_USER"`) && accountForm.includes(marker), 'friendly label did not update Account UI with stable key');
  console.log('PASS: friendly label changed in Account UI while END_USER key stayed fixed.');
  const restoreForms = forms((await page('/administration/labels')).body);
  const restoreIndex = restoreForms.findIndex(form => form.tag.includes('id="label-END_USER"'));
  await submit('/administration/labels', restoreForms[restoreIndex + 1]);
  await waitFor(async () => (await client.terminologyLabel.findUnique({ where: { key: 'END_USER' } }))?.displayLabel, 'End User');
  assert.equal((await client.terminologyLabel.findUnique({ where: { key: 'END_USER' } })).displayLabel, 'End User');
  const restoredForm = (await page('/accounts/new')).body;
  assert.ok(restoredForm.includes('value="END_USER"') && restoredForm.includes('End User'), 'restored label missing from Account UI');
  console.log('PASS: restore-default action returned END_USER to End User.');
  if (originalLabel !== 'End User') console.log('Original custom label will be restored during cleanup.');

  for (const [key, text] of [['STALE_ACCOUNT_WARNING_DAYS', 'Stale account warning (days)'], ['ACTIVITY_LOOKBACK_DAYS', 'Default activity lookback (days)']]) {
    const before = await client.systemSetting.findUnique({ where: { key } });
    saved.settings.push({ key, before });
    const oldValue = before?.value ?? (key === 'STALE_ACCOUNT_WARNING_DAYS' ? 90 : 30);
    const changed = oldValue + 1;
    const settingForms = forms((await page('/administration/settings')).body);
    const settingForm = settingForms.find(form => form.body.includes(text));
    assert.ok(settingForm, `${key} form missing`);
    await submit('/administration/settings', settingForm, { value: String(changed) });
    await waitFor(async () => (await client.systemSetting.findUnique({ where: { key } }))?.value, changed);
    assert.equal((await client.systemSetting.findUnique({ where: { key } })).value, changed);
    const reloaded = (await page('/administration/settings')).body;
    assert.ok(reloaded.includes(`name="value" value="${changed}"`), `${key} did not reload`);
    console.log(`PASS: ${key} saved and reloaded as ${changed}.`);
  }
} finally {
  if (saved.label !== null) await client.terminologyLabel.upsert({ where: { key: 'END_USER' }, create: saved.label, update: saved.label });
  else await client.terminologyLabel.deleteMany({ where: { key: 'END_USER' } });
  for (const { key, before } of saved.settings) {
    if (before) await client.systemSetting.upsert({ where: { key }, create: before, update: before });
    else await client.systemSetting.deleteMany({ where: { key } });
  }
  if (temporaryUserId !== null) {
    await client.externalIdentity.deleteMany({ where: { userId: temporaryUserId } });
    await client.user.delete({ where: { id: temporaryUserId } });
  }
  await client.$disconnect();
}
