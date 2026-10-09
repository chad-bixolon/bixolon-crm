import { test as base, expect } from '@playwright/test';

export { expect };
export type { Page } from '@playwright/test';

export const test = base.extend<{ applicationErrors: string[] }>({
  applicationErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const value = message.text();
      // Local Next.js compilation may briefly reconnect its development socket.
      if (/WebSocket connection to .*_next\/webpack-hmr/.test(value)) return;
      errors.push(`console: ${value}`);
    });
    await use(errors);
    expect(errors, 'uncaught application errors, hydration warnings, or failed resources').toEqual([]);
  }, { auto: true }],
});
