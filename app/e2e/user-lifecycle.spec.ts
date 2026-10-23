import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { saveUser } from '../lib/users';
import { UserImpactRequired } from '../lib/user-lifecycle';
import { eligibleUser } from '../lib/assignment-eligibility';
import { createSupportCase } from '../lib/support-cases';
import { saveTask } from '../lib/work';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.afterAll(() => db.$disconnect());
test('Executive report links and Opportunity pricing respect read capabilities', async ({page}) => {
  const product = await db.product.findUniqueOrThrow({where:{sku:names.sku}});
  const stage = await db.salesStage.findUniqueOrThrow({where:{name:'E2E Qualification'}});
  const sku = await db.productSku.findUniqueOrThrow({where:{normalizedPartNumber:names.sku}});
  const account = await db.account.create({data:{name:uniqueName('Pricing customer')}});
  await db.productSkuOdmCustomer.create({data:{skuId:sku.id,accountId:account.id}});
  const price = await db.productSkuOdmCustomerPrice.create({data:{skuId:sku.id,accountId:account.id,currencyCode:'USD',customerPrice:'171.29',tariffPercent:'9.4226',tariffAmount:'16.14',finalUnitPrice:'187.43',sourceType:'MANUAL'}});
  const pe = await db.priceException.findFirstOrThrow({where:{peCode:names.pe}});
  const peLine = await db.priceExceptionLine.create({data:{priceExceptionId:pe.id,sourceLineKey:uniqueName('Pricing line'),approvedUnitPrice:'193.71'}});
  const opportunity = await db.opportunity.create({data:{name:uniqueName('Pricing boundary'),stageId:stage.id,currencyCode:'USD',products:{create:[
    {productId:product.id,quantity:3,estimatedUnitPrice:'187.43',priceSource:'ODM_CUSTOMER',odmCustomerPriceId:price.id,odmCustomerAccountId:account.id,odmCustomerBasePrice:'171.29',odmCustomerTariffAmount:'16.14',odmCustomerTariffPercent:'9.4226',odmCustomerFinalUnitPrice:'187.43',odmCustomerCurrencyCode:'USD'},
    {productId:product.id,quantity:2,estimatedUnitPrice:'193.71',priceSource:'PRICE_EXCEPTION',priceExceptionLineId:peLine.id,priceExceptionCurrencyCode:'USD',priceExceptionCode:'PRIVATE-PE-HISTORY',priceExceptionUnitPrice:'193.71',archivedAt:new Date()},
  ]}}});
  await signInAs(page,'executive');
  await page.goto('/reports');
  for (const name of ['Pipeline Movement','Forecast Snapshot History','Opportunity Snapshot History']) await expect(page.getByRole('link').filter({has:page.getByRole('heading',{name,exact:true})})).toBeVisible();
  for (const reportType of ['PIPELINE','ACCOUNT_ACTIVITY','PRODUCT_PERFORMANCE','CHANNEL_PARTNER','PROJECT_INITIATIVE']) {
    await page.goto(`/reports/new?reportType=${reportType}&configured=1`);
    await expect(page).not.toHaveURL(/access-denied/);
    await expect(page.getByText(/This page could not be found/)).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Save report/i})).toHaveCount(0);
  }
  await page.goto(`/opportunities/${opportunity.id}`);
  await expect(page.getByRole('heading',{name:'Snapshot History',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:opportunity.name,exact:true})).toBeVisible();
  await page.getByText('Archived product lines (1)',{exact:true}).click();
  await expect(page.getByRole('columnheader',{name:'Unit price',exact:true})).toHaveCount(0);
  for (const sensitive of ['Customer Pricing','171.29','187.43','193.71','PRIVATE-PE-HISTORY']) expect(await page.content()).not.toContain(sensitive);
  await signInAs(page,'salesManager');
  await page.goto(`/opportunities/${opportunity.id}`);
  await expect(page.getByRole('columnheader',{name:'Unit price',exact:true})).toBeVisible();
  await expect(page.getByText(/Base customer price 171.29/)).toBeVisible();
});
for (const width of [1440,1024,820,768,390]) test(`lifecycle form and leadership dashboards at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width,height:900});
  await signInAs(page,'admin');
  await page.goto('/administration/users/new');
  await expect(page.getByLabel('Timezone',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Timezone',{exact:true})).toHaveValue('America/New_York');
  await page.getByLabel('Timezone',{exact:true}).selectOption('Asia/Seoul');
  await expect(page.getByLabel('Timezone',{exact:true})).toHaveValue('Asia/Seoul');
  await expect(page.getByLabel('User Administration Access',{exact:true})).toBeVisible();
  await page.getByLabel('Role *',{exact:true}).selectOption('EXECUTIVE');
  await expect(page.getByText('Broad company visibility without routine operational ownership.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await signInAs(page,'executive');
  await page.goto('/');
  await expect(page.getByText('Company pipeline, forecasts, Sales Plans, Support, and Marketing.',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Administration',exact:true})).toHaveCount(0);
  await page.goto('/administration/users');
  await expect(page).toHaveURL(/access-denied/);
  await signInAs(page,'supportManager');
  await page.goto('/');
  await expect(page.getByText('Team Support workload, aging, backlog, and follow-ups.',{exact:true})).toBeVisible();
  await page.goto('/support/cases');
  await expect(page.getByRole('link',{name:'Support Inbox',exact:true})).toBeVisible();
});
test('persisted lifecycle preview, Unicode/timezone history, and delegated boundaries',async({page})=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:emails.admin}});
  const target=await db.user.create({data:{email:uniqueName('lifecycle').replaceAll(' ','')+'@e2e.saleshub.local',firstName:'민준',lastName:'김',role:'SALES_MANAGER'}});
  await db.account.create({data:{name:uniqueName('Lifecycle account'),ownerId:target.id}});
  await signInAs(page,'admin');await page.goto(`/administration/users/${target.id}/edit`);
  await expect(page.getByText('Not yet linked',{exact:true})).toBeVisible();
  await expect(page.getByText('No recorded changes yet.',{exact:true})).toBeVisible();
  await page.getByLabel('Role *',{exact:true}).selectOption('EXECUTIVE');
  await page.getByLabel('Timezone',{exact:true}).selectOption('Asia/Seoul');
  await page.getByRole('button',{name:'Save user',exact:true}).click();
  await expect(page.getByRole('region',{name:'User change impact'})).toBeVisible();
  expect((await db.user.findUniqueOrThrow({where:{id:target.id}})).role).toBe('SALES_MANAGER');
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save user',exact:true}).click();
  await expect(page.getByText('User updated successfully.')).toBeVisible();
  const saved=await db.user.findUniqueOrThrow({where:{id:target.id}});
  expect(saved.role).toBe('EXECUTIVE');expect(saved.timeZone).toBe('Asia/Seoul');
  expect(await db.account.count({where:{ownerId:target.id}})).toBe(1);
  expect(await db.adminMaintenanceEvent.count({where:{entityType:'User',recordIds:{has:target.id},action:'Role changed'}})).toBe(1);
  const delegate=await db.user.create({data:{email:uniqueName('delegate').replaceAll(' ','')+'@e2e.saleshub.local',firstName:'Delegated',lastName:'Manager',role:'SALES_MANAGER',delegatedUserAdministrationEnabled:true}});
  await expect(saveUser(db,delegate,{...saved,role:'ADMIN'},saved.id)).rejects.toThrow(/Only an Administrator/);
  await expect(saveUser(db,delegate,{...delegate,delegatedUserAdministrationEnabled:false},delegate.id)).rejects.toThrow(/Only an Administrator/);
  expect(eligibleUser(delegate,'account-owner')).toBe(true);
  await expect(saveUser(db,admin,{...delegate,active:false},delegate.id)).rejects.toThrow(/User Administration Access requires an active Sales Manager/);
  expect((await db.user.findUniqueOrThrow({where:{id:delegate.id}})).active).toBe(true);
  await saveUser(db,admin,{...delegate,active:false,delegatedUserAdministrationEnabled:false},delegate.id);
  const deactivated=await db.user.findUniqueOrThrow({where:{id:delegate.id}});
  expect(deactivated.active).toBe(false);
  expect(deactivated.delegatedUserAdministrationEnabled).toBe(false);
});
test('direct server services deny Executive writes and Support Manager general assignments',async()=>{
 const executive=await db.user.findUniqueOrThrow({where:{email:emails.executive}}),manager=await db.user.findUniqueOrThrow({where:{email:emails.supportManager}}),admin=await db.user.findUniqueOrThrow({where:{email:emails.admin}});
 await expect(saveUser(db,executive,{...executive,role:'ADMIN'},executive.id)).rejects.toThrow(/Access denied/);
 await expect(createSupportCase(db,executive,{subject:'Denied',description:'Denied',source:'PHONE'})).rejects.toThrow(/Access denied/);
 const supportCase=await createSupportCase(db,manager,{subject:uniqueName('Manager case'),description:'Team case',customerNameText:'Customer',source:'PHONE',assignedToId:manager.id});
 expect(supportCase.assignedToId).toBe(manager.id);
 const task={subject:'Denied general assignment',description:null,accountId:null,opportunityId:null,projectId:null,supportCaseId:null,contactId:null,assignedToId:manager.id,dueDate:null,status:'OPEN' as const,priority:'NORMAL' as const};
 await expect(saveTask(db,task,undefined,undefined,admin.id,undefined,admin)).rejects.toThrow(/eligible/);
 for(const policy of ['account-owner','opportunity-owner','project-owner','general-task','support-case','support-task','trade-show-sales','sales-plan-owner'] as const) expect(eligibleUser(executive,policy)).toBe(false);
 const before=await db.user.findUniqueOrThrow({where:{id:manager.id}});
 expect(before.role).toBe('SUPPORT_MANAGER');
 expect(UserImpactRequired).toBeDefined();
});

test('identity recovery records only non-secret history and revokes the selected link', async ({page}) => {
 const target=await db.user.create({data:{email:uniqueName('recovery').replaceAll(' ','')+'@e2e.saleshub.local',firstName:'Recovery',lastName:'User',role:'SALES'}});
 const identity=await db.externalIdentity.create({data:{userId:target.id,issuer:'https://accounts.google.com',subject:uniqueName('private-subject')}});
 await signInAs(page,'admin');await page.goto(`/administration/users/${target.id}/edit`);
 await expect(page.getByText('Linked',{exact:true})).toBeVisible();
 await expect(page.getByText(identity.subject,{exact:true})).toHaveCount(0);
 await page.getByLabel(`Type ${target.email} to confirm`).fill(target.email);
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Reset Google sign-in link',exact:true}).click();
 await expect(page.getByText('Not yet linked',{exact:true})).toBeVisible();
 expect(await db.externalIdentity.count({where:{userId:target.id}})).toBe(0);
 const event=await db.adminMaintenanceEvent.findFirstOrThrow({where:{entityType:'User',action:'Identity reset',recordIds:{has:target.id}}});
 expect(event.oldValue).toBeNull();expect(event.newValue).toBeNull();
});

test('leadership read routes and Support Manager team Task corrections', async ({page}) => {
 test.setTimeout(120_000);
 await signInAs(page,'executive');
 for(const path of ['/accounts','/contacts','/opportunities','/pipeline','/projects','/reports/forecast','/reports/opportunity-snapshots','/reports/forecast-snapshots','/reports/pipeline-movement','/sales-plan','/reports/sales-plan','/reports/sales-plan-sku','/reports/marketing-attribution','/support/cases','/demos','/products']) {
   await page.goto(path);
   await expect(page).not.toHaveURL(/access-denied/);
   await expect(page.getByText('Access denied.',{exact:true})).toHaveCount(0);
   await expect(page.getByText(/Application error: a server-side exception/)).toHaveCount(0);
 }
 await page.goto('/support/inbox');await expect(page).toHaveURL(/access-denied/);
 await page.goto('/price-exceptions');await expect(page).toHaveURL(/access-denied/);
 await signInAs(page,'supportManager');
 await page.goto('/administration/support-case-categories');
 await expect(page.getByRole('heading',{name:'Support Case Categories',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Administration',exact:true})).toHaveCount(0);
 await page.goto('/reports/support-cases');await expect(page).not.toHaveURL(/access-denied/);
 await page.goto('/support/inbox');await expect(page.getByRole('heading',{name:'Support Inbox',exact:true})).toBeVisible();
 await page.goto('/administration/system-health');await expect(page).toHaveURL(/access-denied/);
 const manager=await db.user.findUniqueOrThrow({where:{email:emails.supportManager}}),support=await db.user.findUniqueOrThrow({where:{email:emails.support}});
 const supportCase=await createSupportCase(db,manager,{subject:uniqueName('Team follow-up'),description:'Case',customerNameText:'Customer',source:'PHONE',assignedToId:support.id});
 const task=await db.task.create({data:{subject:uniqueName('Team task'),supportCaseId:supportCase.id,assignedToId:support.id,createdById:support.id}});
 await page.goto(`/tasks/${task.id}/edit`);
 await page.getByLabel('Assignee',{exact:true}).selectOption(String(manager.id));
 await page.getByLabel('Priority',{exact:true}).selectOption('HIGH');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect.poll(async()=> (await db.task.findUniqueOrThrow({where:{id:task.id}})).assignedToId).toBe(manager.id);
 expect((await db.task.findUniqueOrThrow({where:{id:task.id}})).priority).toBe('HIGH');
});
