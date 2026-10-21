import { PrismaClient, type Prisma, type User } from '@prisma/client';
import { test, expect, type Page } from './fixtures';
import { databaseUrl, emails, names, baseURL } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { parseContact, saveContact, type ContactInput } from '../lib/contacts';
import { saveProject, type ProjectInput } from '../lib/projects';
import { parseActivity, saveActivity, saveNote } from '../lib/work';
import { saveOpportunity, type OpportunityInput } from '../lib/opportunities';
import { RecordChangedError } from '../lib/stale-edit';
import { resolveUserContext } from '../lib/dev-impersonation';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const message = 'This record changed after you opened it. Review the latest version before saving again.';
const token = (row: { updatedAt: Date }) => row.updatedAt.toISOString();
let admin: User, sales: User, manager: User, readonly: User, accountId: number, otherAccountId: number, stageId: number;
test.beforeAll(async () => {
  [admin, sales, manager, readonly] = await Promise.all([emails.admin, emails.sales, emails.salesManager, emails.readOnly].map(email => db.user.findUniqueOrThrow({ where: { email } })));
  accountId = (await db.account.findFirstOrThrow({ where: { name: names.account } })).id;
  otherAccountId = (await db.account.findFirstOrThrow({ where: { name: names.otherAccount } })).id;
  stageId = (await db.salesStage.findUniqueOrThrow({ where: { name: 'E2E Qualification' } })).id;
});
test.afterAll(() => db.$disconnect());
function contactInput(): ContactInput {
  const form = new FormData(); form.set('firstName', uniqueName('Shared')); form.set('lastName', 'Contact'); form.set('accountId', String(accountId));
  return parseContact(form).value!;
}
function projectInput(): ProjectInput {
  return { name: uniqueName('Shared Project'), primaryAccountId: accountId, primaryAccountRole: 'PROGRAM_OWNER', ownerId: sales.id, status: 'PLANNING', startDate: null, targetEndDate: null, description: 'Original details', participants: [{ accountId: otherAccountId, roles: ['ISV'] }] };
}
function activityInput() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ subject: uniqueName('Shared Activity'), accountId, userId: sales.id, type: 'CALL', activityDate: '2026-01-01T12:00', direction: 'NA' })) form.set(key, String(value));
  return parseActivity(form).value!;
}
function opportunityInput(projectIds: number[] = []): OpportunityInput {
  return { name: uniqueName('Shared linked Opportunity'), description: null, ownerId: sales.id, projectIds, stageId, expectedCloseDate: null, probability: null, forecastCategory: 'PIPELINE', currencyCode: 'USD', participants: [{ accountId, roles: ['END_USER'] }], contacts: [], lines: [] };
}

test('Contact versions protect details, Account, preferences, primary transfers, Admin and effective users without history', async () => {
  const input = contactInput(), id = await saveContact(db, input, undefined, admin);
  const opened = await db.contact.findUniqueOrThrow({ where: { id } });
  const newer = { ...input, title: 'Latest title', marketingPreference: 'OPTED_OUT' as const, isPrimary: true };
  await saveContact(db, newer, id, manager, token(opened));
  const saved = await db.contact.findUniqueOrThrow({ where: { id } });
  expect(saved.updatedAt.getTime()).toBeGreaterThan(opened.updatedAt.getTime());
  const history = await db.adminMaintenanceEvent.count();
  const context = await resolveUserContext({ ...admin, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  for (const actor of [admin, manager, sales, context.effective!]) for (let n = 0; n < 2; n++) {
    await expect(saveContact(db, { ...input, accountId: otherAccountId, title: 'Older title', marketingPreference: 'OPTED_IN' }, id, actor, token(opened))).rejects.toThrow(message);
  }
  expect(await db.contact.findUniqueOrThrow({ where: { id } })).toEqual(saved);
  expect(await db.adminMaintenanceEvent.count()).toBe(history);
  await expect(saveContact(db, input, id, readonly, token(saved))).rejects.toThrow('Access denied');
  // Promoting another Contact advances the demoted Contact's own token, too.
  const other = contactInput(), otherId = await saveContact(db, { ...other, isPrimary: true }, undefined, admin);
  expect((await db.contact.findUniqueOrThrow({ where: { id: otherId } })).isPrimary).toBe(true);
  const demoted = await db.contact.findUniqueOrThrow({ where: { id } });
  expect(demoted.isPrimary).toBe(false); expect(demoted.updatedAt.getTime()).toBeGreaterThan(saved.updatedAt.getTime());
  await expect(saveContact(db, newer, id, admin, token(saved))).rejects.toThrow(message);
  expect((await db.contact.findUniqueOrThrow({ where: { id: otherId } })).isPrimary).toBe(true);
});

test('Contact losing the atomic comparison after primary demotion rolls back every relationship change', async () => {
  const isolatedAccount = await db.account.create({ data: { name: uniqueName('Primary rollback Account') } });
  const primaryInput = { ...contactInput(), accountId: isolatedAccount.id, isPrimary: true };
  const primaryId = await saveContact(db, primaryInput, undefined, admin);
  const targetInput = { ...contactInput(), accountId: isolatedAccount.id };
  const id = await saveContact(db, targetInput, undefined, admin);
  const before = await db.contact.findMany({ where: { id: { in: [primaryId, id] } }, orderBy: { id: 'asc' } });
  const opened = before.find(row => row.id === id)!;
  let demotions = 0;
  const failingDb = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<number>) => db.$transaction(tx => fn({
    ...tx, contact: { ...tx.contact, update: async (args: Prisma.ContactUpdateArgs) => {
      if (args.where.id === id) throw new RecordChangedError();
      demotions++;
      return tx.contact.update(args);
    } },
  } as unknown as Prisma.TransactionClient)) } as unknown as PrismaClient;
  await expect(saveContact(failingDb, { ...targetInput, isPrimary: true }, id, admin, token(opened))).rejects.toThrow(message);
  expect(demotions).toBe(1);
  expect(await db.contact.findMany({ where: { id: { in: [primaryId, id] } }, orderBy: { id: 'asc' } })).toEqual(before);
});

test('Project version protects participant replacement, linked Opportunities, permissions and rollback', async () => {
  const input = projectInput(), id = await saveProject(db, input, admin);
  const opened = await db.project.findUniqueOrThrow({ where: { id } });
  const newer = { ...input, name: 'Latest Project', description: 'Newer details', status: 'ACTIVE' as const, participants: [{ accountId: otherAccountId, roles: ['OEM' as const, 'ISV' as const] }] };
  await saveProject(db, newer, manager, id, token(opened));
  const saved = await db.project.findUniqueOrThrow({ where: { id } });
  const history = await db.adminMaintenanceEvent.count();
  const context = await resolveUserContext({ ...admin, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  for (const actor of [admin, manager, sales, context.effective!]) for (let n = 0; n < 2; n++) await expect(saveProject(db, { ...input, participants: [] }, actor, id, token(opened))).rejects.toThrow(message);
  expect(await db.project.findUniqueOrThrow({ where: { id } })).toEqual(saved);
  expect((await db.projectAccountRole.findMany({ where: { projectId: id }, orderBy: { role: 'asc' } })).map(row => row.role).sort()).toEqual(['ISV', 'OEM']);
  expect(await db.adminMaintenanceEvent.count()).toBe(history);
  await expect(saveProject(db, input, readonly, id, token(saved))).rejects.toThrow('Access denied');
  await expect(saveProject(db, input, { ...sales, id: manager.id }, id, token(saved))).rejects.toThrow('Access denied');
  // Force a failure after parent claim and participant removal using a real transaction.
  const failingDb = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<number>) => db.$transaction(async tx => {
    const wrapped = { ...tx, projectAccount: { ...tx.projectAccount, upsert: async () => { throw new Error('Injected participant failure'); } } };
    return fn(wrapped as unknown as Prisma.TransactionClient);
  }) } as unknown as PrismaClient;
  const replacement = { ...newer, primaryAccountId: otherAccountId, participants: [{ accountId, roles: ['END_CUSTOMER' as const] }] };
  await expect(saveProject(failingDb, replacement, admin, id, token(saved))).rejects.toThrow('Injected participant failure');
  expect(await db.project.findUniqueOrThrow({ where: { id } })).toEqual(saved);
  expect(await db.projectAccountRole.count({ where: { projectId: id } })).toBe(2);
  const oppInput = opportunityInput([id]), opportunityId = await saveOpportunity(db, oppInput, undefined, admin);
  const linked = await db.project.findUniqueOrThrow({ where: { id } });
  expect(linked.updatedAt.getTime()).toBeGreaterThan(saved.updatedAt.getTime());
  await expect(saveProject(db, newer, admin, id, token(saved))).rejects.toThrow(message);
  expect(await db.opportunityProject.count({ where: { projectId: id, opportunityId } })).toBe(1);
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  await saveOpportunity(db, { ...oppInput, projectIds: [] }, opportunityId, admin, token(opp));
  await expect(saveProject(db, newer, admin, id, token(linked))).rejects.toThrow(message);
  expect(await db.opportunityProject.count({ where: { projectId: id } })).toBe(0);
});

test('Activity and Note use their own advancing token; stale changes leave content and parents intact', async () => {
  const activity = activityInput(), a = await saveActivity(db, activity, undefined, admin.id);
  const latest = await saveActivity(db, { ...activity, subject: 'Newer Activity' }, a.id, manager.id, undefined, token(a));
  const noteInput = { body: 'Original Note', accountId, opportunityId: null, projectId: null, supportCaseId: null, createdById: sales.id };
  const n = await saveNote(db, noteInput, undefined, admin.id);
  const note = await saveNote(db, { ...noteInput, body: 'Newer Note' }, n.id, manager.id, token(n));
  expect(latest.updatedAt.getTime()).toBeGreaterThan(a.updatedAt.getTime());
  expect(note.updatedAt.getTime()).toBeGreaterThan(n.updatedAt.getTime());
  for (let i = 0; i < 2; i++) {
    await expect(saveActivity(db, { ...activity, accountId: otherAccountId }, a.id, admin.id, undefined, token(a))).rejects.toThrow(message);
    await expect(saveNote(db, { ...noteInput, body: 'Older Note', accountId: otherAccountId }, n.id, admin.id, token(n))).rejects.toThrow(message);
  }
  expect(await db.activity.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ subject: 'Newer Activity', accountId });
  expect(await db.note.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ body: 'Newer Note', accountId });
  expect(await db.activityContact.count({ where: { activityId: a.id } })).toBe(0);
});

test('simultaneous saves with the same Contact or Project token admit exactly one writer', async () => {
  const c = contactInput(), contactId = await saveContact(db, c, undefined, admin);
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const p = projectInput(), projectId = await saveProject(db, p, admin);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  for (const race of [
    () => [saveContact(db, { ...c, title: 'First' }, contactId, admin, token(contact)), saveContact(db, { ...c, title: 'Second' }, contactId, manager, token(contact))],
    () => [saveProject(db, { ...p, participants: [] }, admin, projectId, token(project)), saveProject(db, { ...p, participants: [{ accountId: otherAccountId, roles: ['OEM'] }] }, manager, projectId, token(project))],
  ]) {
    const result = await Promise.allSettled(race());
    expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(row => row.status === 'rejected')).toHaveLength(1);
  }
});

// Wait for React to attach the submit handler before typing into server-rendered
// uncontrolled fields, especially textareas whose initial text hydrates separately.
async function openEditor(page: Page, path: string) {
  await page.goto(path);
  await expect.poll(() => page.locator('form').filter({ has: page.locator('[name="editToken"]') }).evaluate(element => {
    const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
    return !!propsKey && typeof (element as unknown as Record<string, { onSubmit?: unknown }>)[propsKey]?.onSubmit === 'function';
  })).toBe(true);
}

type Kind = 'Contact' | 'Project' | 'Activity' | 'Note';
for (const width of [1440, 768, 390]) for (const kind of ['Contact', 'Project', 'Activity', 'Note'] as Kind[]) {
  test(`${kind}: two users, retained draft, invalid tokens and review/reload at ${width}px`, async ({ page, browser }, testInfo) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 1000 });
    let id: number, path: string, label: string, button: string;
    if (kind === 'Contact') { id = await saveContact(db, contactInput(), undefined, admin); path = `/contacts/${id}/edit`; label = 'First name *'; button = 'Save contact'; }
    else if (kind === 'Project') { id = await saveProject(db, projectInput(), admin); path = `/projects/${id}/edit`; label = 'Project name *'; button = 'Save Project'; }
    else if (kind === 'Activity') { id = (await saveActivity(db, activityInput(), undefined, admin.id)).id; path = `/activities/${id}/edit`; label = 'Subject *'; button = 'Save changes'; }
    else { id = (await saveNote(db, { body: 'Original Note', accountId, opportunityId: null, projectId: null, supportCaseId: null, createdById: sales.id }, undefined, admin.id)).id; path = `/notes/${id}/edit`; label = 'Note'; button = 'Save changes'; }
    await signInAs(page, 'sales'); await openEditor(page, path);
    const draft = `My entered ${kind} ${width}`;
    const latestValue = uniqueName(`Latest ${kind} ${width}`);
    await page.getByLabel(label, { exact: true }).fill(draft);
    if (kind === 'Project') { await page.getByLabel('Description', { exact: true }).fill('Keep my Project draft'); await page.getByLabel('OEM', { exact: true }).check(); }
    if (kind === 'Contact') { await page.getByLabel('Marketing communications', { exact: true }).selectOption('OPTED_IN'); await page.getByLabel('Primary contact for selected account', { exact: true }).check(); }
    const oldToken = await page.locator('[name="editToken"]').inputValue();
    const second = await browser.newContext({ baseURL });
    try {
      const newer = await second.newPage();
      await signInAs(newer, 'salesManager'); await openEditor(newer, path);
      expect(await newer.locator('[name="editToken"]').inputValue()).toBe(oldToken);
      await newer.getByLabel(label, { exact: true }).fill(latestValue);
      if (kind === 'Contact') await newer.getByLabel('Marketing communications', { exact: true }).selectOption('OPTED_OUT');
      if (kind === 'Project') { await newer.getByLabel('Description', { exact: true }).fill('Latest Project details'); await newer.getByLabel('Service Provider', { exact: true }).check(); }
      await newer.getByRole('button', { name: button, exact: true }).click();
      await expect(newer).not.toHaveURL(path);
      const history = await db.adminMaintenanceEvent.count();
      for (const badToken of [oldToken, '', 'invalid', '2026-02-30T12:00:00.000Z', oldToken]) {
        await page.locator('[name="editToken"]').evaluate((node, value) => { (node as HTMLInputElement).value = value; }, badToken);
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(page.getByText(message, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
        await expect(page.getByLabel(label, { exact: true })).toHaveValue(draft);
      }
      // A missing field is rejected server-side as well.
      await page.locator('[name="editToken"]').evaluate(node => node.remove());
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      if (kind === 'Contact') { expect(await db.contact.findUniqueOrThrow({ where: { id } })).toMatchObject({ firstName: latestValue, marketingPreference: 'OPTED_OUT', isPrimary: false }); await expect(page.getByLabel('Primary contact for selected account', { exact: true })).toBeChecked(); await expect(page.getByLabel('Marketing communications', { exact: true })).toHaveValue('OPTED_IN'); }
      if (kind === 'Project') { expect((await db.projectAccountRole.findMany({ where: { projectId: id } })).map(row => row.role).sort()).toEqual(['ISV', 'SERVICE_PROVIDER']); await expect(page.getByLabel('OEM', { exact: true })).toBeChecked(); await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Keep my Project draft'); }
      expect(await db.adminMaintenanceEvent.count()).toBe(history);
      await expect(page.getByText(message, { exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${kind}-review-${width}.png`), fullPage: true });
      const popup = page.waitForEvent('popup');
      await page.getByRole('link', { name: 'Review latest record', exact: true }).click();
      const latest = await popup; await latest.waitForLoadState('domcontentloaded'); await latest.close();
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(draft);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Reload latest form', exact: true }).click();
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(latestValue);
      expect(await page.locator('[name="editToken"]').inputValue()).not.toBe(oldToken);
      await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    } finally { await second.close(); }
  });
}

test('Project-page link invalidates an older Project edit without losing participants or link history', async ({ page, browser }) => {
  const projectId = await saveProject(db, projectInput(), admin), input = opportunityInput(), opportunityId = await saveOpportunity(db, input, undefined, admin);
  await signInAs(page, 'sales'); await page.goto(`/projects/${projectId}/edit`);
  await page.getByLabel('Project name *').fill('Older Project draft');
  const second = await browser.newContext({ baseURL });
  try {
    const newer = await second.newPage(); await signInAs(newer, 'salesManager'); await newer.goto(`/projects/${projectId}?tab=opportunities`);
    await newer.getByLabel('Existing Opportunity').fill(input.name);
    await newer.getByRole('option', { name: new RegExp(input.name) }).first().click();
    await newer.getByRole('button', { name: 'Link Opportunity', exact: true }).click();
    await expect(newer.getByRole('link', { name: input.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save Project', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    expect(await db.opportunityProject.count({ where: { projectId, opportunityId } })).toBe(1);
    expect(await db.projectAccount.count({ where: { projectId } })).toBe(1);
    expect(await db.opportunityHistoryEvent.count({ where: { opportunityId, eventType: 'PROJECT_LINKED' } })).toBe(1);
  } finally { await second.close(); }
});
