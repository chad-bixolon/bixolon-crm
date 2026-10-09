import { expect, type Page } from '@playwright/test';
import { authToken, emails } from './constants.mjs';

export async function signInAs(page: Page, role: keyof typeof emails) {
  const csrfResponse = await page.request.get('/api/auth/csrf');
  expect(csrfResponse.ok()).toBeTruthy();
  const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
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
