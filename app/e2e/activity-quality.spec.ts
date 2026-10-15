import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

const db = new PrismaClient({ datasourceUrl: databaseUrl });
test.beforeAll(async () => {
  for (const [code, name] of [['CALL', 'Call'], ['MEETING', 'Meeting'], ['EMAIL', 'Email'], ['FOLLOW_UP', 'Follow-up']]) {
    await db.activityType.upsert({ where: { code }, update: { active: true }, create: { code, name } });
  }
});
test.afterAll(() => db.$disconnect());

for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
  test(`Activity form, validation, timeline and detail at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const account = await db.account.findFirstOrThrow({ where: { name: names.account } });
    const contact = await db.contact.findFirstOrThrow({ where: { accountId: account.id, firstName: 'E2E Jane' } });
    const user = await db.user.findUniqueOrThrow({ where: { email: emails.salesManager } });
    await page.setViewportSize({ width, height });
    await signInAs(page, 'salesManager');
    let lastId = 0;
    for (const type of ['CALL', 'MEETING', 'EMAIL', 'FOLLOW_UP']) {
      await page.goto(`/activities/new?contactId=${contact.id}`);
      await expect(page.locator('input[name="accountId"]')).toHaveValue(String(account.id));
      await expect(page.locator('input[name="contactIds"]')).toHaveValue(String(contact.id));
      await expect(page.getByLabel('Activity type')).toHaveValue('CALL');
      await expect(page.getByLabel('Responsible user')).toHaveValue(String(user.id));
      await expect(page.getByLabel('Activity date and time')).not.toHaveValue('');
      await page.getByLabel('Activity type').selectOption(type, { timeout: 10_000 });
      if (type === 'MEETING') await expect(page.getByRole('note')).toContainText('Calendar Matches');
      if (type === 'EMAIL') await expect(page.getByRole('note')).toContainText('sent or received');
      if (type === 'FOLLOW_UP') await expect(page.getByRole('note')).toContainText('already happened');
      const subject = uniqueName(`Quality ${type}`);
      await page.getByLabel('Subject').fill(subject);
      const description = page.getByLabel('Description');
      const initialHeight = (await description.boundingBox())!.height;
      const notes = Array.from({ length: 35 }, (_, index) => `Line ${index}: customer discussion and agreed next step.`).join('\n');
      await description.fill(notes);
      expect((await description.boundingBox())!.height).toBeGreaterThan(initialHeight);
      expect(await description.evaluate(element => getComputedStyle(element).resize)).toBe('vertical');
      if (type === 'CALL') {
        await page.getByLabel('Activity date and time').fill('2099-01-01T12:00');
        await page.getByRole('button', { name: 'Create activity', exact: true }).click();
        await expect(page.getByText(/Activities record completed work. Choose/)).toBeVisible();
        await expect(page.getByLabel('Subject')).toHaveValue(subject);
        await expect(description).toHaveValue(notes);
        await expect(page.locator('input[name="accountId"]')).toHaveValue(String(account.id));
        await expect(page.locator('input[name="contactIds"]')).toHaveValue(String(contact.id));
      }
      await page.getByLabel('Activity date and time').fill('2026-01-10T14:30');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`activity-${type}-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Create activity', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}.*tab=activity`));
      const row = await db.activity.findFirstOrThrow({ where: { subject }, include: { contacts: true } });
      lastId = row.id;
      expect(row.type).toBe(type); expect(row.userId).toBe(user.id);
      expect(row.accountId).toBe(account.id); expect(row.contacts.map(link => link.contactId)).toEqual([contact.id]);
      expect(row.activityDate.toISOString()).toBe('2026-01-10T14:30:00.000Z');
      const link = page.getByRole('link', { name: subject, exact: true });
      await expect(link).toHaveAttribute('href', `/activities/${row.id}`);
      await link.click();
      await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
      await expect(page.getByRole('main')).toContainText(`${user.firstName} ${user.lastName}`);
      await expect(page.getByRole('link', { name: account.name, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: `${contact.firstName} ${contact.lastName}`, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await signInAs(page, 'readOnly');
    await page.goto(`/activities/${lastId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit activity', exact: true })).toHaveCount(0);
    for (const route of ['/activities/new', `/activities/${lastId}/edit`]) {
      await page.goto(route);
      await expect(page).toHaveURL(/access-denied/);
    }
  });
}

test('Activity relationship prefills keep known context and leave ambiguous Accounts blank', async ({ page }) => {
  test.setTimeout(90_000);
  const opportunity = await db.opportunity.findFirstOrThrow({ where: { name: 'E2E Picker Opportunity' }, include: { participants: true } });
  const project = await db.project.findFirstOrThrow({ where: { name: 'E2E Picker Project' } });
  const accountId = opportunity.participants[0].accountId;
  const other = await db.account.findFirstOrThrow({ where: { name: names.otherAccount } });
  const ambiguous = await db.opportunity.create({ data: { name: uniqueName('Ambiguous Activity context'), stageId: opportunity.stageId, ownerId: opportunity.ownerId, participants: { create: [{ accountId }, { accountId: other.id }] } } });
  await signInAs(page, 'salesManager');
  for (const [query, field, id] of [[`opportunityId=${opportunity.id}`, 'opportunityId', opportunity.id], [`projectId=${project.id}`, 'projectId', project.id], [`accountId=${accountId}`, 'accountId', accountId]] as const) {
    await page.goto(`/activities/new?${query}`);
    await expect(page.locator(`input[name="${field}"]`)).toHaveValue(String(id));
    await expect(page.locator('input[name="accountId"]')).toHaveValue(String(accountId));
  }
  await page.goto(`/activities/new?opportunityId=${ambiguous.id}`);
  await expect(page.locator('input[name="accountId"]')).toHaveValue('');
  await expect(page.locator('input[name="opportunityId"]')).toHaveValue(String(ambiguous.id));
});

test('Support Case Activity retains Case context and opens an authorized detail without Sales edit access', async ({ page }) => {
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.support } });
  const account = await db.account.findFirstOrThrow({ where: { name: names.account } });
  const contact = await db.contact.findFirstOrThrow({ where: { accountId: account.id, firstName: 'E2E Jane' } });
  const supportCase = await db.supportCase.create({ data: { caseNumber: uniqueName('BXS-ACTIVITY'), subject: 'Activity quality case', description: 'Synthetic Activity quality fixture.', source: 'PHONE', status: 'OPEN', accountId: account.id, contactId: contact.id, assignedToId: user.id, createdById: user.id, updatedById: user.id } });
  await signInAs(page, 'support');
  await page.goto(`/activities/new?supportCaseId=${supportCase.id}`);
  await expect(page.getByText(supportCase.caseNumber, { exact: false }).first()).toBeVisible();
  await expect(page.locator('input[name="accountId"]')).toHaveValue(String(account.id));
  await expect(page.locator('input[name="contactIds"]')).toHaveValue(String(contact.id));
  const subject = uniqueName('Support call');
  await page.getByLabel('Subject').fill(subject);
  await page.getByRole('button', { name: 'Create activity', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/support/cases/${supportCase.id}`));
  const row = await db.activity.findFirstOrThrow({ where: { subject } });
  await page.getByRole('button', { name: 'Show timeline', exact: true }).click();
  await page.locator(`a[href="/activities/${row.id}"]`).click();
  await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: supportCase.caseNumber, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit activity', exact: true })).toHaveCount(0);
  const salesActivity = await db.activity.create({ data: { type: 'CALL', subject: uniqueName('Sales only Activity'), accountId: account.id, userId: user.id } });
  const response = await page.request.get(`/activities/${salesActivity.id}`);
  expect(response.status()).toBe(404);
});
