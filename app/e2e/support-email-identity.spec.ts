import { test, expect } from './fixtures';
import { signInAs } from './helpers';

// This file runs against synthetic fixtures in the disposable E2E database.
// Never exercise manual actions against live Gmail identities.
test('duplicate-looking Gmail messages stay separate and ignoring one preserves its sibling', async ({ page }) => {
  const googleRequests: string[] = [];
  page.on('request', request => { if (/googleapis\.com|accounts\.google\.com/.test(request.url())) googleRequests.push(request.url()); });
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Mailbox status' })).toContainText('Mode: MOCK');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  const copy = (id: string) => page.locator(`article[aria-labelledby="message-${id}"]`);
  const first = copy('poc-duplicates-a');
  const second = copy('poc-duplicates-b');
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  await expect(first.getByRole('heading')).toHaveText('Same text');
  await expect(second.getByRole('heading')).toHaveText('Same text');
  await expect(first.getByRole('link', { name: 'Create Case', exact: true })).toHaveAttribute('href', '/support/cases/new?emailMessageId=poc-duplicates-a');
  await expect(second.getByRole('link', { name: 'Create Case', exact: true })).toHaveAttribute('href', '/support/cases/new?emailMessageId=poc-duplicates-b');
  for (let index = 1; index <= 5; index++) await expect(copy(`poc-thread-${index}`)).toHaveCount(1);
  try {
    await first.getByRole('button', { name: 'Ignore', exact: true }).click();
    await expect(first).toHaveCount(0);
    await expect(second).toHaveCount(1);
    await expect(second.getByRole('button', { name: 'Ignore', exact: true })).toBeVisible();
    await page.getByRole('link', { name: /Show ignored messages/ }).click();
    const ignored = page.getByRole('region', { name: 'Ignored messages' });
    await expect(ignored.locator('article').filter({ hasText: 'Same text' })).toHaveCount(1);
    await expect(second).toHaveCount(1);
  } finally {
    // Restore the synthetic dismissal even if an assertion fails.
    await page.goto('/support/inbox?showIgnored=1');
    const ignoredCopy = page.getByRole('region', { name: 'Ignored messages' }).locator('article').filter({ has: page.locator('input[name="messageId"][value="poc-duplicates-a"]') });
    if (await ignoredCopy.count()) {
      await ignoredCopy.getByRole('button', { name: 'Restore to inbox' }).click();
      await expect(first).toHaveCount(1);
    }
  }
  await expect(second).toHaveCount(1);
  expect(googleRequests).toEqual([]);
});

test('Ignore rejects a forged signed inbox source and keeps the message visible', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  const card = page.locator('article[aria-labelledby="message-poc-duplicates-b"]');
  const form = card.locator('form').filter({ has: page.getByRole('button', { name: 'Ignore', exact: true }) });
  // Tamper at submission time so hydration cannot restore the hidden value.
  await form.evaluate(form => form.addEventListener('submit', () => {
    const source = form.querySelector<HTMLInputElement>('input[name="emailSource"]')!;
    source.value += 'forged';
  }, { capture: true, once: true }));
  await form.getByRole('button', { name: 'Ignore', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Invalid or expired Support email source');
  await expect(card).toHaveCount(1);
  await page.reload();
  await expect(card).toHaveCount(1);
});
