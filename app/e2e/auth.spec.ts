import { test, expect } from '@playwright/test';
import { signInAs } from './helpers';

for (const role of ['admin', 'support', 'sales', 'salesManager'] as const) {
  test(`${role} can sign in with isolated local E2E auth`, async ({ page }) => {
    await signInAs(page, role);
    await expect(page.getByRole('main')).toBeVisible();
  });
}
