import { test, expect } from './fixtures';
import { signInAs, uniqueName } from './helpers';

const googleRequests = new WeakMap<import('@playwright/test').Page, string[]>();
test.beforeEach(async ({ page }) => {
  const requests: string[] = []; googleRequests.set(page, requests);
  page.on('request', request => { if (/googleapis\.com|accounts\.google\.com/.test(request.url())) requests.push(request.url()); });
});
test.afterEach(async ({ page }) => { expect(googleRequests.get(page)).toEqual([]); });

test('Support can inspect suggestions, link a message, and see only linked Account context', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/cases/new');
  await page.getByLabel('Customer / End User').fill('E2E Picker Account');
  await page.getByRole('combobox', { name: 'Linked CRM Account (optional)' }).fill('E2E Picker Account');
  await page.getByRole('option', { name: /^E2E Picker Account Philadelphia, PA$/ }).click();
  await page.getByLabel('Subject').fill(uniqueName('E2E email POC case'));
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('EMAIL');
  await page.getByLabel('Description').fill('Initial issue');
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
  const caseUrl = page.url();
  const caseNumber = (await page.getByRole('heading', { level: 1 }).textContent())?.match(/BXS-\d{4}-\d{6}/)?.[0];
  expect(caseNumber).toBeTruthy();
  await page.goto('/support/inbox');
  await expect(page.getByRole('heading', { name: 'Support Inbox' })).toBeVisible();
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Mailbox status' })).toContainText('Mode: MOCK');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  const email = page.getByRole('article').filter({ hasText: 'POC intake manual request' });
  await expect(email).toContainText('E2E Picker Contact');
  await expect(email).toContainText('E2E Picker Account');
  await expect(email).toContainText('Matched: E2E Picker Account · E2E Picker Contact');
  await email.getByRole('button', { name: 'Match details', exact: true }).click();
  await expect(email.getByText(/Exact Contact match by sender email/)).toBeVisible();
  await expect(email).toContainText('Account suggested from matched Contact');
  await expect(email).toContainText(caseNumber!);
  await email.getByRole('button', { name: 'Link to Case', exact: true }).click();
  await email.getByLabel('Or exact case number').fill(caseNumber!);
  await email.getByRole('button', { name: 'Confirm link', exact: true }).click();
  await expect(page).toHaveURL(caseUrl);
  const timeline = page.getByRole('region', { name: 'Case Timeline' });
  await timeline.getByRole('button', { name: 'Show timeline' }).click();
  await expect(timeline).toContainText('Email received · POC intake manual request');
  await expect(timeline).toContainText('e2e-picker-00@example.test');
  const account = await page.request.get('/support/cases/search?kind=account&q=E2E%20Picker%20Account');
  const accountId = (await account.json()).results.find((row: { name: string }) => row.name === 'E2E Picker Account').id;
  await signInAs(page, 'sales');
  await page.goto('/support/inbox');
  await expect(page).not.toHaveURL(/\/support\/inbox$/);
  await page.goto(`/accounts/${accountId}?tab=support`);
  await expect(page.getByRole('heading', { name: 'Linked support emails' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Linked support emails' }).locator('..')).toContainText('POC intake manual request');
  await expect(page.getByRole('heading', { name: 'Linked support emails' }).locator('..')).not.toContainText('Unrelated mailbox message');
});

test('compact queue, Manage, matching and case-link disclosures fit phone, tablet, and desktop', async ({ page }, testInfo) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  const mailbox = page.getByRole('region', { name: 'Mailbox status' });
  const manage = mailbox.getByRole('button', { name: 'Manage', exact: true });
  const email = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'POC intake manual request', exact: true }) });
  const link = email.getByRole('button', { name: 'Link to Case', exact: true });
  const details = email.getByRole('button', { name: 'Match details', exact: true });
  const number = email.getByLabel('Or exact case number');
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(mailbox).toContainText('Gmail disconnected (mock messages)');
    await expect(mailbox).toContainText('support@bixolonusa.com');
    await expect(mailbox).toContainText('Last synced');
    await expect(mailbox.getByRole('note')).toHaveText('Gmail is read-only. SalesHub actions do not modify the mailbox.');
    await expect(manage).toHaveAttribute('aria-expanded', 'false');
    await expect(mailbox.getByText('Showing messages from the last 30 days')).toBeHidden();
    await expect(number).toBeHidden();
    await expect(email.getByLabel('Suggested case')).toBeHidden();
    await expect(email).toContainText('Matched: E2E Picker Account · E2E Picker Contact');
    await expect(page.getByRole('article').filter({ hasText: 'Printer will not power on' })).toContainText('No confident CRM match');
    await expect(page.getByRole('article').filter({ hasText: 'POC intake files request' }).getByText('4 attachments', { exact: true })).toBeVisible();
    await expect(page.getByRole('article').getByRole('checkbox')).toHaveCount(0);
    await expect(email.getByRole('link', { name: 'Create Case', exact: true })).toBeVisible();
    const first = await page.getByRole('article').first().boundingBox();
    // Keep the first message close to the compact triage/scope controls.
    expect(first!.y).toBeLessThan(width === 390 ? 580 : 410);
    await page.screenshot({ path: testInfo.outputPath(`inbox-${width}.png`), fullPage: false, caret: 'initial' });

    await manage.focus();
    await page.keyboard.press('Enter');
    await expect(manage).toHaveAttribute('aria-expanded', 'true');
    await expect(mailbox.getByText('Showing messages from the last 30 days')).toBeVisible();
    await expect(mailbox).toContainText('Last fetch result: Fetched');
    await expect(mailbox.getByText('Gmail read-only', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(manage).toBeFocused();
    await expect(manage).toHaveAttribute('aria-expanded', 'false');
    await manage.click();
    await page.getByRole('heading', { name: 'Support Inbox', exact: true }).click();
    await expect(manage).toHaveAttribute('aria-expanded', 'false');

    await details.click();
    await expect(email.getByText(/Exact Contact match by sender email/)).toBeVisible();
    await details.click();
    await expect(email.getByText(/Exact Contact match by sender email/)).toBeHidden();
    await link.focus();
    await page.keyboard.press('Space');
    await expect(link).toHaveAttribute('aria-expanded', 'true');
    await expect(number).toBeVisible();
    await number.fill('BXS-2026-999999');
    await number.press('Escape');
    await expect(link).toBeFocused();
    await expect(number).toBeHidden();
    await link.click();
    await expect(number).toHaveValue('BXS-2026-999999');
    await email.getByRole('button', { name: 'Confirm link', exact: true }).click();
    await expect(email.getByRole('alert')).toContainText('Support Case number not found');
    await expect(number).toHaveValue('BXS-2026-999999');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`inbox-link-${width}.png`), fullPage: false, caret: 'initial' });
    await link.click();
    await expect(number).toBeHidden();
    await page.getByRole('heading', { name: 'Support Inbox' }).scrollIntoViewIfNeeded();
  }
});

test('Create Case from Email prefills normal form, retains context on failure and saves one Case with timeline', async ({ page, context }, testInfo) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  const email = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'POC intake matched request', exact: true }) });
  await email.getByRole('link', { name: 'Create Case', exact: true }).click();
  await expect(page).toHaveURL(/\/support\/cases\/new\?emailMessageId=/);
  const sourceUrl = page.url();
  await expect(page.getByRole('region', { name: 'Support email source' })).toContainText('E2E Picker Contact');
  await expect(page.getByRole('region', { name: 'Support email source' })).toContainText('e2e-picker-00@example.test');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('POC intake matched request');
  await expect(page.getByLabel('Customer / End User')).toHaveValue('E2E Picker Contact');
  await expect(page.locator('input[name="accountIdLabel"]')).toHaveValue('E2E Picker Account');
  await expect(page.locator('input[name="contactIdLabel"]')).toHaveValue('E2E Picker Contact');
  await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue('EMAIL');
  await expect(page.getByLabel('Description')).toHaveValue(/Original email request[\s\S]*Please help with the printer/);
  const description = page.getByRole('textbox', { name: 'Description / Email Thread', exact: true });
  const importedThread = await description.inputValue();
  const token = await page.locator('input[name="emailSource"]').inputValue();
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('region', { name: 'Support email source' })).toBeVisible();
    await expect(description).toHaveValue(importedThread);
    expect((await description.boundingBox())!.height).toBeGreaterThanOrEqual(width < 640 ? 280 : width < 1024 ? 320 : 360);
    expect(await description.evaluate(el => getComputedStyle(el).resize)).toBe('vertical');
    await description.locator('..').screenshot({ path: testInfo.outputPath(`email-description-${width}.png`), caret: 'initial' });
    await page.screenshot({ path: testInfo.outputPath(`email-form-${width}.png`), fullPage: true, caret: 'initial' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  // Force server-side validation, then verify the signed source and entered fields survived.
  await page.locator('select[name="assignedToId"]').evaluate(select => { const option = new Option('Invalid', '999999'); select.append(option); (select as HTMLSelectElement).value = '999999'; });
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Support Rep');
  await expect(page.locator('input[name="emailSource"]')).toHaveValue(token);
  await expect(description).toHaveValue(importedThread);
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('POC intake matched request');
  await page.locator('select[name="assignedToId"]').selectOption('');
  const second = await context.newPage();
  await second.goto(sourceUrl);
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
  const caseUrl = page.url();
  await second.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(second).toHaveURL(caseUrl + '?emailIntake=already-linked');
  await expect(second.getByRole('status')).toContainText('No additional Case was created');
  await second.close();
  const timeline = page.getByRole('region', { name: 'Case Timeline' });
  await timeline.getByRole('button', { name: 'Show timeline' }).click();
  await expect(timeline).toContainText('Case originated from email · POC intake matched request');
  await expect(timeline).toContainText('e2e-picker-00@example.test');
  await timeline.getByText('Read full email').click();
  await expect(timeline.locator('details')).toContainText('Please help with the printer.');
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.goto(sourceUrl);
  await expect(page).toHaveURL(caseUrl + '?emailIntake=already-linked');
});

test('unmatched sender carries name/email and allows manual Account/Contact selection', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  await page.getByRole('article').filter({ hasText: 'POC intake unmatched request' }).getByRole('link', { name: 'Create Case', exact: true }).click();
  await expect(page.getByLabel('Customer / End User')).toHaveValue('New Requester');
  await expect(page.getByRole('region', { name: 'Support email source' })).toContainText('intake-new@example.test');
  await expect(page.getByRole('combobox', { name: 'Linked CRM Account (optional)' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Contact', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Linked CRM Account (optional)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
  await expect(page.getByRole('main')).toContainText('intake-new@example.test');
});

test('invalid source query, forged signed source and denied user cannot use intake', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/cases/new?emailMessageId=forged');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('unavailable or invalid');
  await expect(page.getByRole('button', { name: 'Create case', exact: true })).toHaveCount(0);
  await page.goto('/support/inbox');
  await page.getByRole('article').filter({ hasText: 'POC intake invalid request' }).getByRole('link', { name: 'Create Case', exact: true }).click();
  await expect(page).toHaveURL(/\/support\/cases\/new\?emailMessageId=/);
  await page.locator('input[name="emailSource"]').evaluate(input => { (input as HTMLInputElement).value += 'forged'; });
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Invalid or expired Support email source');
  await signInAs(page, 'sales');
  await page.goto('/support/cases/new?emailMessageId=poc-xd5-1');
  await expect(page).not.toHaveURL(/\/support\/cases\/new/);
});

test('email files are optional, selected attachments/inline photos use Case storage, and review prevents duplicates', async ({ page, context }, testInfo) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  await page.getByRole('article').filter({ hasText: 'POC intake files request' }).getByRole('link', { name: 'Create Case', exact: true }).click();
  const files = page.getByRole('region', { name: 'Email attachments' });
  await expect(files.getByRole('checkbox', { name: /error-log.txt/ })).not.toBeChecked();
  await expect(files.getByRole('checkbox', { name: /printer-photo.png/ })).not.toBeChecked();
  await expect(files.getByText('signature-logo.png', { exact: true })).toHaveCount(0);
  await expect(files.getByText('tracking-pixel.png', { exact: true })).toHaveCount(0);
  await expect(files.getByRole('checkbox', { name: /program.exe/ })).toBeDisabled();
  await expect(files.getByRole('checkbox', { name: /huge.log/ })).toBeDisabled();
  await files.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(files.getByRole('checkbox', { name: /error-log.txt/ })).toBeChecked();
  await files.getByRole('button', { name: 'Clear all', exact: true }).click();
  for (const [width, height] of [[390,844],[768,1024],[1440,900]]) {
    await page.setViewportSize({ width, height });
    await expect(files).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`email-files-${width}.png`), fullPage: true, caret: 'initial' });
  }
  await files.getByRole('checkbox', { name: /error-log.txt/ }).check();
  await files.getByRole('checkbox', { name: /printer-photo.png/ }).check();
  const repeated = await context.newPage();
  await repeated.goto(page.url());
  await repeated.getByRole('checkbox', { name: /error-log.txt/ }).check();
  await repeated.getByRole('checkbox', { name: /printer-photo.png/ }).check();
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+\?emailFiles=complete$/);
  const casePath = new URL(page.url()).pathname;
  await repeated.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(repeated).toHaveURL(new RegExp(casePath + '\\?emailIntake=already-linked&emailFiles=complete$'));
  await expect(repeated.getByRole('region', { name: 'Attachments', exact: true })).toContainText('Attachments · 2');
  await repeated.close();

  const attachments = page.getByRole('region', { name: 'Attachments', exact: true });
  await expect(attachments).toContainText('Attachments · 2');
  await expect(attachments).toContainText('error-log.txt');
  await expect(attachments).toContainText('printer-photo.png');
  await expect(attachments).toContainText('Imported from Support email');
  await expect(attachments).not.toContainText('signature-logo');
  const description = page.getByRole('heading', { name: 'Description', exact: true }).locator('..');
  await expect(description).toContainText('Printer problem with optional files.');
  await expect(description).not.toContainText('Printer diagnostic log');
  await expect(description).not.toContainText('base64');
  const download = attachments.getByRole('link', { name: 'Download', exact: true }).first();
  const response = await page.request.get((await download.getAttribute('href'))!);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-disposition']).toContain('attachment');
  await page.getByRole('link', { name: 'Import files from linked email' }).click();
  await expect(page.getByRole('checkbox', { name: /error-log.txt/ })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /printer-photo.png/ })).toBeDisabled();
  await page.getByRole('link', { name: 'Back to Case', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(casePath + '$'));
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).toContainText('Attachments · 2');
});

test('forged file grant is rejected before saving; no selected file means no file copy', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  await page.getByRole('article').filter({ hasText: 'POC intake files-unselected request' }).getByRole('link', { name: 'Create Case', exact: true }).click();
  const files = page.getByRole('region', { name: 'Email attachments' });
  const file = files.getByRole('checkbox', { name: /error-log.txt/ });
  await file.check();
  await file.evaluate(element => { (element as HTMLInputElement).value += 'forged'; });
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Invalid email file selection');
  await expect(page).toHaveURL(/\/support\/cases\/new\?/);
  await files.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).toContainText('Attachments · 0');
});

test('one optional file failure preserves the Case/email and other files, then retries without duplicates', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  await page.getByRole('article', { name: 'POC intake files-failure request', exact: true }).getByRole('link', { name: 'Create Case', exact: true }).click();
  const files = page.getByRole('region', { name: 'Email attachments' });
  await files.getByRole('checkbox', { name: /error-log.txt/ }).check();
  await files.getByRole('checkbox', { name: /retry-log.txt/ }).check();
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+\?emailFiles=partial$/);
  const casePath = new URL(page.url()).pathname;
  await expect(page.getByRole('region', { name: 'Email file import issues' })).toContainText('retry-log.txt');
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).toContainText('Attachments · 1');
  const timeline = page.getByRole('region', { name: 'Case Timeline' });
  await timeline.getByRole('button', { name: 'Show timeline' }).click();
  await expect(timeline).toContainText('Case originated from email');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Email file import issues' })).toContainText('retry-log.txt');
  await page.getByRole('link', { name: 'Review / retry email attachments' }).click();
  await expect(page.getByRole('checkbox', { name: /error-log.txt/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: /retry-log.txt/ }).check();
  await page.getByRole('button', { name: 'Import selected files', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(casePath + '\\?emailFiles=complete$'));
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).toContainText('Attachments · 2');
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).not.toContainText('printer-photo.png');
  await expect(page.getByRole('region', { name: 'Email file import issues' })).toHaveCount(0);
  await signInAs(page, 'sales');
  await page.goto(`${casePath}/email-attachments`);
  await expect(page).not.toHaveURL(/\/email-attachments$/);
});


test('manual linking to an existing Case can optionally import files afterward without creating another Case', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  await page.getByRole('article').filter({ hasText: 'POC intake manual request' }).getByRole('link', { name: 'Create Case', exact: true }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+\?emailIntake=already-linked$/);
  const casePath = new URL(page.url()).pathname;
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).toContainText('Attachments · 0');
  await page.getByRole('link', { name: 'Import files from linked email' }).click();
  await page.getByRole('checkbox', { name: /error-log.txt/ }).check();
  await page.getByRole('button', { name: 'Import selected files', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(casePath + '\\?emailFiles=complete$'));
  await expect(page.getByRole('region', { name: 'Attachments', exact: true })).toContainText('Attachments · 1');
});

test('existing Ignore and Restore actions still handle only the local queue', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  const heading = page.getByRole('heading', { name: 'POC intake invalid request', exact: true });
  const email = page.getByRole('article').filter({ has: heading });
  await email.getByRole('button', { name: 'Ignore', exact: true }).click();
  await expect(heading).toHaveCount(0);
  await page.getByRole('link', { name: /Show ignored messages/ }).click();
  const ignored = page.getByRole('region', { name: 'Ignored messages' }).getByRole('article').filter({ hasText: 'POC intake invalid request' });
  await ignored.getByRole('button', { name: 'Restore to inbox', exact: true }).click();
  await expect(heading).toBeVisible();
  await expect(ignored).toHaveCount(0);
  await expect(page.getByRole('note')).toHaveText('Gmail is read-only. SalesHub actions do not modify the mailbox.');
});
