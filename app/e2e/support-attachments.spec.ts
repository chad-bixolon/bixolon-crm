import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

const fixture = (name: string) => resolve(process.cwd(), 'e2e/fixtures', name);

test('case attachments upload, download, validate, remove, and follow permissions and lifecycle', async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, 'support');
  await page.goto('/support/cases/new');
  await page.getByLabel('Customer / End User').fill('E2E attachment customer');
  await page.getByRole('combobox', { name: 'Linked CRM Account (optional)' }).fill(names.account);
  await page.getByRole('option', { name: names.account }).click();
  await page.getByLabel('Subject').fill(uniqueName('E2E attachment case'));
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('PHONE');
  await page.getByLabel('Description').fill('Investigate printer diagnostic artifacts.');
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
  const caseUrl = page.url();
  const attachments = page.getByRole('region', { name: 'Attachments' });
  await expect(attachments).toContainText('No attachments have been added');
  await attachments.getByRole('button', { name: 'Add Attachment' }).click();
  await attachments.getByLabel('File').setInputFiles(fixture('sample.prn'));
  await attachments.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(attachments).toContainText('sample.prn');
  await expect(attachments).toContainText('E2E support');
  await expect(attachments).toContainText('1 KB');
  await expect(attachments.getByRole('status')).toContainText('Attachment uploaded.');
  const link = attachments.getByRole('link', { name: 'Download' });
  await expect(link).toHaveAttribute('href', /\/api\/support\/attachments\/\d+\/download/);
  const first = await page.request.get(await link.getAttribute('href') || '', { maxRedirects: 0 });
  expect(first.status()).toBe(307);
  expect(first.headers().location).toContain('/api/e2e/objects?');
  const file = await page.request.get(first.headers().location);
  expect(file.ok()).toBeTruthy(); expect(await file.text()).toContain('Test label');

  await attachments.getByRole('button', { name: 'Add Attachment' }).click();
  await attachments.getByLabel('File').setInputFiles({ name: 'oversized.log', mimeType: 'text/plain', buffer: Buffer.alloc(25 * 1024 * 1024 + 1, 65) });
  await attachments.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(attachments.getByRole('alert')).toContainText('File is too large.');
  await expect(attachments.getByLabel('File')).toHaveValue(/oversized.log/);
  await expect(attachments).toContainText('sample.prn');
  const unsupported = await page.request.post(`${new URL(caseUrl).pathname.replace('/support/cases/', '/api/support/cases/')}/attachments`, { multipart: { file: { name: 'unsupported.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ test') } } });
  expect(unsupported.status()).toBe(400);

  await signInAs(page, 'readOnly'); await page.goto(caseUrl);
  await expect(attachments).toContainText('sample.prn');
  await expect(attachments.getByRole('link', { name: 'Download' })).toBeVisible();
  const readOnlyDownload = await page.request.get(await attachments.getByRole('link', { name: 'Download' }).getAttribute('href') || '', { maxRedirects: 0 });
  expect(readOnlyDownload.status()).toBe(307);
  await expect(attachments.getByRole('button', { name: 'Add Attachment' })).toHaveCount(0);
  await expect(attachments.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  const denied = await page.request.post(`${new URL(caseUrl).pathname.replace('/support/cases/', '/api/support/cases/')}/attachments`, { multipart: { file: { name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('test') } } });
  expect(denied.status()).toBe(403);

  await signInAs(page, 'support'); await page.goto(caseUrl);
  page.once('dialog', dialog => dialog.accept());
  const removal = page.waitForResponse(response => /\/api\/support\/attachments\/\d+$/.test(response.url()) && response.request().method() === 'DELETE');
  await attachments.getByRole('button', { name: 'Remove' }).click();
  expect((await removal).status()).toBe(200);
  await expect(attachments).toContainText('No attachments have been added');
  const timeline = page.getByRole('region', { name: 'Case Timeline' });
  await timeline.getByRole('button', { name: 'Show timeline' }).click();
  await expect(timeline.getByRole('heading', { name: 'Attachment added' })).toBeVisible();
  await expect(timeline.getByRole('heading', { name: 'Attachment removed' })).toBeVisible();

  await attachments.getByRole('button', { name: 'Add Attachment' }).click();
  await attachments.getByLabel('File').setInputFiles(fixture('sample.txt'));
  await attachments.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(attachments).toContainText('sample.txt');

  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Status').selectOption('CLOSED');
  await page.getByLabel(/Resolution Summary/).fill('Diagnostics complete.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(attachments).toContainText('sample.txt');
  await expect(attachments.getByRole('button', { name: 'Add Attachment' })).toHaveCount(0);
  await expect(attachments.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Archived Support Case')).toBeVisible();
  await expect(attachments).toContainText('sample.txt');
  await expect(attachments.getByRole('button', { name: 'Add Attachment' })).toHaveCount(0);
  await expect(attachments.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});
