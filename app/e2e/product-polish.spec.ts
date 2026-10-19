import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { signInAs } from './helpers';
import { databaseUrl } from './constants.mjs';
import { snapshotWeek } from '../lib/opportunity-snapshots';

test('integration navigation and older snapshot references reach working destinations', async ({ page }) => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  let selectedId: number;
  let selectedAt: string;
  try {
    let at = new Date('2007-01-01T17:00:00Z');
    while (await db.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: snapshotWeek(at) } })) at = new Date(+at + 7 * 86400000);
    const selected = await db.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), source: 'SCHEDULED', createdByName: 'Navigation fixture', opportunityCount: 0 } });
    selectedId = selected.id;
    selectedAt = selected.snapshotAt.toISOString();
    // Make the selected capture older than the recent-list limit, independently of other suites.
    for (let i = 0; i < 13; i++) {
      at = new Date(+at + 7 * 86400000);
      while (await db.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: snapshotWeek(at) } })) at = new Date(+at + 7 * 86400000);
      await db.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), source: 'SCHEDULED', createdByName: 'Navigation fixture', opportunityCount: 0 } });
    }
  } finally { await db.$disconnect(); }
  await signInAs(page, 'admin');
  await page.goto('/integrations');
  await expect(page).toHaveURL('/administration/maintenance-history?view=integrations');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Integration & Job History');
  await page.goto(`/administration/opportunity-snapshots?snapshot=${selectedId}#snapshot-${selectedId}`);
  const selected = page.locator(`#snapshot-${selectedId}`);
  await expect(selected).toContainText(`Snapshot #${selectedId}`);
  await selected.locator('summary').click();
  await expect(selected.locator('time')).toHaveAttribute('datetime', selectedAt);
});

test('filtered notification emptiness does not claim all work is cleared', async ({ page }) => {
  await signInAs(page, 'readOnly');
  await page.goto('/notifications?view=active&category=tasks&severity=CRITICAL');
  await expect(page.getByRole('heading', { name: 'No notifications match these filters' })).toBeVisible();
  await expect(page.getByText("You don't have anything requiring attention right now.")).toHaveCount(0);
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL('/notifications?view=active');
});

test('mobile history filters preserve mounted values and keep their history view when cleared', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signInAs(page, 'admin');
  await page.goto('/administration/maintenance-history?view=integrations&status=Failed&from=2003-02-01');
  await page.getByRole('button', { name: /Show filters/ }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('Recovered');
  await page.getByRole('button', { name: /Hide filters/ }).click();
  await expect(page.locator('select[name=status]')).toHaveValue('Recovered');
  await page.getByRole('button', { name: /Show filters/ }).click();
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/view=integrations/);
  await expect(page).toHaveURL(/status=Recovered/);
  await page.locator('.filter-disclosure-clear').click();
  await expect(page).toHaveURL('/administration/maintenance-history?view=integrations');
  await expect(page.locator('select[name=status]')).toHaveValue('');
  for (const route of ['/reports/opportunity-snapshots', '/reports/forecast-snapshots']) {
    await page.goto(route);
    await page.getByRole('button', { name: 'Show filters', exact: true }).click();
    await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Show filters', exact: true })).toBeVisible();
  }
});

test('ownership clear keeps the chosen record type and Support can find its case report', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/administration/ownership?entity=Task&owner=999999');
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL('/administration/ownership?entity=Task');
  await expect(page.getByLabel('Record type', { exact: true })).toHaveValue('Task');
  await signInAs(page, 'support');
  await page.goto('/support/cases');
  await page.getByRole('link', { name: 'Case report', exact: true }).click();
  await expect(page).toHaveURL('/reports/support-cases');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Access denied');
});
