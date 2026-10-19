import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, baseURL, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.describe.configure({ mode: 'serial' });
const routes = ['/', '/opportunities?currencyCode=USD', '/opportunities/new', '/pipeline?currencyCode=USD', '/reports/forecast?currencyCode=USD', '/reports/pipeline-movement?currencyCode=USD', '/reports/pipeline-movement/history?currencyCode=USD', '/reports/forecast-movement?currencyCode=USD', '/reports/opportunity-snapshots', '/reports/forecast-snapshots', '/reports/new', '/reports/new?reportType=PRODUCT_PERFORMANCE', '/reports/new?reportType=CHANNEL_PARTNER', '/reports/new?reportType=PROJECT_INITIATIVE', '/reports/new?reportType=PRICE_EXCEPTION_USAGE', '/reports/new?reportType=TRADE_SHOW', '/sales-plan', '/reports/sales-plan', '/reports/sales-plan-sku', '/administration/sales-targets', '/administration/history'];
let original: {code:string;active:boolean;isDefault:boolean}[];
test.beforeAll(async () => {
  original = await db.currency.findMany({select:{code:true,active:true,isDefault:true}});
  await db.$transaction(async tx => {
    await tx.currency.updateMany({data:{isDefault:false}});
    await tx.currency.updateMany({where:{code:{not:'USD'}},data:{active:false}});
    await tx.currency.update({where:{code:'USD'},data:{active:true,isDefault:true}});
  });
});
test.afterAll(async () => {
  await db.$transaction(async tx => {
    await tx.currency.updateMany({data:{isDefault:false}});
    await tx.currency.updateMany({where:{code:{notIn:original.map(row=>row.code)}},data:{active:false}});
    for (const row of original) await tx.currency.update({where:{code:row.code},data:{active:row.active,isDefault:row.isDefault}});
  });
  await db.$disconnect();
});

test('single currency hides redundant controls across desktop, tablets and phone', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signInAs(page,'admin');
  for (const width of [1440,768,820,1024,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('main h1')).toBeVisible();
      // Finish this dev page's hydration before moving through the next route.
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main select[name="currencyCode"], main select[name="currency"], main input.field[name="currencyCode"]')).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(/one currency per view|each view uses one currency|Values are shown in one currency/i);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), `${width}px ${route}`).toBe(true);
    }
    await page.goto('/reports/pipeline-movement/history?currencyCode=USD');
    await page.screenshot({path:testInfo.outputPath(`currency-${width}.png`),fullPage:true,caret:'initial'});
  }
});

test('Admin adds currency, changes default, protects default and retains history on deactivation', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page,'admin');
  await page.goto('/administration/currencies');
  const cadRow = page.getByRole('row').filter({has:page.getByRole('cell',{name:'CAD',exact:true})});
  if (await cadRow.count()) await cadRow.getByRole('button',{name:'Activate',exact:true}).click();
  else {await page.getByRole('combobox',{name:'Currency',exact:true}).selectOption('CAD');await page.getByRole('button',{name:'Add currency',exact:true}).click();}
  await cadRow.getByRole('button',{name:'Set as default'}).click();
  await expect(cadRow).toContainText('Default');
  await expect(cadRow.getByRole('button',{name:'Deactivate',exact:true})).toHaveCount(0);
  for (const route of ['/opportunities/new','/reports/forecast','/reports/pipeline-movement','/reports/pipeline-movement/history','/sales-plan','/reports/sales-plan','/reports/new']) {
    await page.goto(route);
    await expect(page.locator('main select[name="currencyCode"],main select[name="currency"]')).toHaveCount(1);
    if(route!=='/reports/new') await expect(page.locator('main select[name="currencyCode"]')).toHaveValue('CAD');
  }
  // A stored historical record is never converted when the default changes.
  const rep = await db.user.findUniqueOrThrow({where:{email:emails.sales}});
  const stage = await db.salesStage.findFirstOrThrow({where:{active:true,isClosed:false}});
  const opportunity = await db.opportunity.create({data:{name:uniqueName('Currency history'),ownerId:rep.id,stageId:stage.id,currencyCode:'CAD'}});
  await page.goto('/administration/currencies');
  await page.getByRole('row').filter({has:page.getByRole('cell',{name:'USD',exact:true})}).getByRole('button',{name:'Set as default'}).click();
  await cadRow.getByRole('button',{name:'Deactivate',exact:true}).click();
  await expect(cadRow).toContainText('Inactive');
  await page.goto('/opportunities/new');
  await expect(page.locator('select[name="currencyCode"]')).toHaveCount(0);
  await expect(page.locator('input[type="hidden"][name="currencyCode"]')).toHaveValue('USD');
  await page.goto(`/opportunities/${opportunity.id}/edit`);
  await expect(page.locator('select[name="currencyCode"]')).toHaveValue('CAD');
  await page.goto('/reports/forecast?currencyCode=CAD');
  await expect(page.locator('select[name="currencyCode"]')).toHaveValue('CAD');
  expect((await db.opportunity.findUniqueOrThrow({where:{id:opportunity.id}})).currencyCode).toBe('CAD');
});

test('Saved Views preserve currency with hidden selectors and old USD URLs work', async ({ page }) => {
  await signInAs(page,'admin');
  const name = uniqueName('E2E saved currency');
  await page.goto('/opportunities?currencyCode=USD');
  await page.locator('.saved-views-menu summary').click();
  await page.getByRole('button',{name:'Save current view'}).click();
  await page.getByRole('dialog',{name:'Save current view'}).getByRole('textbox',{name:'View name'}).fill(name);
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await db.savedView.findFirstOrThrow({where:{name}})).queryState).toEqual({currencyCode:'USD'});
  await page.goto('/opportunities');await page.locator('.saved-views-menu summary').click();await page.getByRole('button',{name,exact:true}).click();
  await expect(page).toHaveURL(/currencyCode=USD/);
  await page.goto('/reports/forecast?currencyCode=USD');
  await expect(page.locator('[name="currencyCode"]')).toHaveValue('USD');
});

test('non-Admins and impersonated Sales cannot administer currency settings', async ({ page, context }) => {
  for (const role of ['sales','salesManager','readOnly','support','marketing'] as const) {
    await signInAs(page,role);await page.goto('/administration/currencies');await expect(page).toHaveURL(/access-denied/);
  }
  await signInAs(page,'admin');
  const rep = await db.user.findUniqueOrThrow({where:{email:emails.sales}});
  await context.addCookies([{name:'saleshub-dev-impersonate-user',value:String(rep.id),url:baseURL}]);
  await page.goto('/administration/currencies');await expect(page).toHaveURL(/access-denied/);
});

test('Currency Settings fits desktop, tablet and phone', async ({ page }, testInfo) => {
  await signInAs(page,'admin');
  for (const width of [1440,768,820,1024,390]) {
    await page.setViewportSize({width,height:1000});
    await page.goto('/administration/currencies');
    await expect(page.getByRole('heading',{name:'Currency Settings',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Add currency',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px`).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`currency-settings-${width}.png`),fullPage:true,caret:'initial'});
  }
});
