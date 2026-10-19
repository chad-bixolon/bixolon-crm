import { expect, type Page } from '@playwright/test';
import { authToken, emails } from './constants.mjs';

export async function signInAs(page: Page, role: keyof typeof emails) {
  // Stop requests from the previous role's page before replacing session cookies.
  // Late Auth.js responses can otherwise roll its old session over the new login.
  await page.goto('about:blank');
  let csrfToken = '';
  await expect.poll(async () => {
    const response = await page.request.get('/api/auth/csrf', { maxRetries: 2 });
    if (!response.ok()) return response.status();
    csrfToken = (await response.json() as { csrfToken: string }).csrfToken;
    return csrfToken ? response.status() : 0;
  }, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBe(200);
  const response = await page.request.post('/api/auth/callback/e2e', {
    form: { csrfToken, email: emails[role], token: authToken, callbackUrl: '/' },
    maxRedirects: 0,
  });
  expect(response.status(), `E2E login redirected to ${response.headers().location ?? response.url()}: ${await response.text()}`).toBe(302);
  expect(response.headers().location).not.toContain('/sign-in');
  expect(response.headers().location).not.toContain('/access-denied');
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/sign-in|\/access-denied/);
}

export function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function watchApplicationErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`page: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const value = message.text();
    // Next's development socket can reconnect during initial compilation.
    if (/WebSocket connection to .*_next\/webpack-hmr/.test(value)) return;
    errors.push(`console: ${value}`);
  });
  return errors;
}
