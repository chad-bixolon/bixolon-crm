import { test, expect } from './fixtures';
import { signInAs } from './helpers';

for (const role of ['admin', 'support', 'sales', 'salesManager', 'marketing', 'readOnly'] as const) {
  test(`${role} can sign in with isolated local E2E auth`, async ({ page }) => {
    await signInAs(page, role);
    await expect(page.getByRole('main')).toBeVisible();
  });
}
