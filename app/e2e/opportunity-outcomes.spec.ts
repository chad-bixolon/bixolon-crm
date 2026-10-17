import { PrismaClient, type User } from '@prisma/client';
import { test, expect, type Page } from './fixtures';
import { databaseUrl, emails, names, baseURL } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { saveOpportunity, listOpportunities, type OpportunityInput } from '../lib/opportunities';
import { businessToday } from '../lib/price-exception-dates';
import { saveOutcomeReason } from '../lib/outcome-reasons';
import { archiveHistoryBatch, restoreHistoryBatch } from '../lib/opportunity-history';
import { resolveUserContext } from '../lib/dev-impersonation';
import { adminAudit } from '../lib/admin-audit';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let admin: User, sales: User, manager: User, openId: number, wonId: number, lostId: number;
test.beforeAll(async () => {
  [admin, sales, manager] = await Promise.all([emails.admin,emails.sales,emails.salesManager].map(email => db.user.findUniqueOrThrow({where:{email}})));
  openId = (await db.salesStage.findUniqueOrThrow({where:{name:'E2E Qualification'}})).id;
  for (const isWon of [true,false]) {
    const stage = await db.salesStage.upsert({where:{name:`E2E Outcome ${isWon ? 'Won' : 'Lost'}`},update:{isClosed:true,isWon,active:true},create:{name:`E2E Outcome ${isWon ? 'Won' : 'Lost'}`,isClosed:true,isWon,probability:isWon?100:0,sortOrder:isWon?900:910}});
    if (isWon) wonId=stage.id; else lostId=stage.id;
  }
});
test.afterAll(() => db.$disconnect());
async function fixture(ownerId = sales.id) {
  const account = await db.account.findFirstOrThrow({where:{name:names.account}}), product = await db.product.findUniqueOrThrow({where:{sku:names.sku}});
  const input: OpportunityInput = {name:uniqueName('Outcome deal'),description:null,ownerId,projectIds:[],stageId:openId,expectedCloseDate:new Date('2027-03-31T12:00:00Z'),probability:null,forecastCategory:'PIPELINE',currencyCode:'USD',participants:[{accountId:account.id,roles:['END_USER']}],contacts:[],lines:[{productId:product.id,quantity:1,price:'100.00',priceSource:'MANUAL'}]};
  return { id:await saveOpportunity(db,input,undefined,admin), input };
}
const selectedReason = (isWon: boolean) => db.outcomeReason.findFirstOrThrow({where:{isWon,active:true},orderBy:{sortOrder:'asc'}});
async function saveForm(page: Page) {
  await page.getByRole('button',{name:'Save opportunity',exact:true}).click();
  await expect(page).toHaveURL(/\/opportunities\/\d+(\?|$)/);
}

test('server enforces outcomes, owner edit rules, effective-user roles, filters, audit and archive preservation', async () => {
  const f=await fixture(), won=await selectedReason(true), lost=await selectedReason(false);
  const close={...f.input,stageId:wonId,actualCloseDate:new Date('2026-10-15T00:00:00Z'),outcomeReasonId:won.id,outcomeNotes:'Expanded to 40 sites'};
  for (const value of [{...close,actualCloseDate:null},{...close,outcomeReasonId:null},{...close,outcomeReasonId:lost.id},{...close,outcomeNotes:'x'.repeat(2001)}]) await expect(saveOpportunity(db,value,f.id,sales)).rejects.toThrow(/Actual Close Date|Outcome Reason|2000/);
  expect((await db.opportunity.findUniqueOrThrow({where:{id:f.id}})).stageId).toBe(openId);
  await saveOpportunity(db,close,f.id,sales);
  let row=await db.opportunity.findUniqueOrThrow({where:{id:f.id}});
  expect(row.actualCloseDate?.toISOString().slice(0,10)).toBe('2026-10-15'); expect(row.expectedCloseDate?.toISOString()).toBe(f.input.expectedCloseDate?.toISOString());
  const original=await db.opportunityHistoryEvent.findFirstOrThrow({where:{opportunityId:f.id,eventType:'CLOSED'}});
  expect(original.newOutcome).toMatchObject({outcomeReason:won.name,outcomeNotes:close.outcomeNotes,actualCloseDate:'2026-10-15',status:'Closed Won'});
  await expect(saveOpportunity(db,close,f.id,{...sales,id:manager.id,role:'SALES'})).rejects.toThrow(/own Opportunities/);
  for (const role of ['READ_ONLY','MARKETING_MANAGER','SUPPORT'] as const) await expect(saveOpportunity(db,close,f.id,{...sales,role})).rejects.toThrow(/Access denied/);
  const context=await resolveUserContext({...admin,name:'Admin'},String(sales.id),db,{NODE_ENV:'development',ENABLE_DEV_IMPERSONATION:'true'});
  await expect(saveOutcomeReason(db,context.effective!,{name:'Denied',isWon:true,active:true,sortOrder:0})).rejects.toThrow(/Access denied/);
  const other=await fixture(manager.id);
  await expect(saveOpportunity(db,{...other.input,stageId:wonId,actualCloseDate:close.actualCloseDate,outcomeReasonId:won.id},other.id,context.effective!)).rejects.toThrow(/own Opportunities/);
  expect((await listOpportunities(db,{ownerId:String(sales.id),outcomeStatus:'won',outcomeReasonId:String(won.id),actualCloseFrom:'2026-10-15',actualCloseTo:'2026-10-15'},manager)).opportunities.some(o=>o.id===f.id)).toBe(true);
  const audit=await adminAudit(db,admin,{entity:'Opportunity',action:'Outcome'});
  expect(audit.rows.some(event=>event.recordId===f.id && event.after?.includes(won.name))).toBe(true);
  await saveOpportunity(db,{...close,stageId:openId},f.id,manager);
  row=await db.opportunity.findUniqueOrThrow({where:{id:f.id}});
  expect([row.actualCloseDate,row.outcomeReasonId,row.outcomeReasonName,row.outcomeNotes]).toEqual([null,null,null,null]);
  expect((await db.opportunityHistoryEvent.findFirstOrThrow({where:{opportunityId:f.id,eventType:'OUTCOME_REOPENED'}})).oldOutcome).toEqual(original.newOutcome);
  await expect(saveOpportunity(db,{...f.input,stageId:lostId},f.id,sales)).rejects.toThrow(/Actual Close Date/);
  await expect(saveOpportunity(db,{...close,stageId:lostId},f.id,sales)).rejects.toThrow(/Closed Lost/);
  await saveOpportunity(db,{...f.input,stageId:lostId,actualCloseDate:new Date('2026-10-16T00:00:00Z'),outcomeReasonId:lost.id},f.id,sales);
  expect(await db.opportunityHistoryEvent.count({where:{opportunityId:f.id,eventType:'CLOSED'}})).toBe(2);
  await db.opportunityHistoryEvent.update({where:{id:original.id},data:{occurredAt:new Date('2000-01-01')}});
  const archived=await archiveHistoryBatch(db,admin,new Date('2001-01-01'));
  expect((await db.opportunityHistoryArchive.findUniqueOrThrow({where:{sourceId:original.id}})).newOutcome).toEqual(original.newOutcome);
  await restoreHistoryBatch(db,admin,archived.batch);
  expect((await db.opportunityHistoryEvent.findUniqueOrThrow({where:{id:original.id}})).newOutcome).toEqual(original.newOutcome);
});

test('outcome date, reason and notes corrections preserve previous values', async () => {
  const f=await fixture(), reason=await selectedReason(true);
  const another=await db.outcomeReason.findFirstOrThrow({where:{isWon:true,active:true,id:{not:reason.id}}});
  const close={...f.input,stageId:wonId,actualCloseDate:new Date('2026-10-15T00:00:00Z'),outcomeReasonId:reason.id,outcomeNotes:'Original context'};
  await saveOpportunity(db,close,f.id,sales);
  await saveOpportunity(db,{...close,actualCloseDate:new Date('2026-10-14T00:00:00Z'),outcomeReasonId:another.id,outcomeNotes:'Corrected context'},f.id,sales);
  const event=await db.opportunityHistoryEvent.findFirstOrThrow({where:{opportunityId:f.id,eventType:'OUTCOME_UPDATED'}});
  expect(event.oldOutcome).toMatchObject({actualCloseDate:'2026-10-15',outcomeReason:reason.name,outcomeNotes:'Original context'});
  expect(event.newOutcome).toMatchObject({actualCloseDate:'2026-10-14',outcomeReason:another.name,outcomeNotes:'Corrected context'});
});

test('legacy unknown outcomes remain valid, inactive and renamed reason references preserve labels', async ({page}) => {
  const f=await fixture(); await db.opportunity.update({where:{id:f.id},data:{stageId:lostId,forecastCategory:'OMITTED'}});
  await saveOpportunity(db,{...f.input,stageId:lostId,description:'Unrelated edit'},f.id,sales);
  expect((await db.opportunity.findUniqueOrThrow({where:{id:f.id}})).actualCloseDate).toBeNull();
  await signInAs(page,'sales'); await page.goto(`/opportunities/${f.id}`);
  await expect(page.getByRole('region',{name:'Opportunity outcome'})).toContainText('Unknown');
  const reason=await saveOutcomeReason(db,admin,{name:uniqueName('Preserved reason'),isWon:false,active:true,sortOrder:1000});
  const close={...f.input,stageId:lostId,actualCloseDate:new Date('2026-10-15T00:00:00Z'),outcomeReasonId:reason.id,outcomeNotes:'Original details'};
  await saveOpportunity(db,close,f.id,sales);
  await saveOutcomeReason(db,admin,{name:uniqueName('Renamed reason'),isWon:false,active:false,sortOrder:1500},reason.id);
  await saveOpportunity(db,{...close,description:'Still valid'},f.id,sales);
  await expect(db.outcomeReason.delete({where:{id:reason.id}})).rejects.toThrow();
  await page.goto(`/opportunities/${f.id}`); await expect(page.getByRole('region',{name:'Opportunity outcome'})).toContainText(reason.name);
  await page.goto(`/opportunities/${f.id}/edit`); await expect(page.getByLabel('Outcome Reason')).toContainText(`${reason.name} (Inactive)`);
  const fresh=await fixture(); await expect(saveOpportunity(db,{...fresh.input,stageId:lostId,actualCloseDate:close.actualCloseDate,outcomeReasonId:reason.id},fresh.id,sales)).rejects.toThrow(/active/);
});

for (const width of [1440,768,390]) test(`close, reopen and re-close fit ${width}px with correct reason choices`, async ({page}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({width,height:900}); const f=await fixture();
  await signInAs(page,'sales'); await page.goto(`/opportunities/${f.id}/edit`);
  await expect(page.getByLabel('Actual Close Date')).toHaveCount(0);
  await page.getByLabel('Sales stage *').selectOption(String(wonId));
  await expect(page.getByLabel('Actual Close Date')).toHaveValue(businessToday().toISOString().slice(0,10));
  const reasons=page.getByLabel('Outcome Reason'); await expect(reasons).toContainText('Existing customer expansion'); await expect(reasons).not.toContainText('Lost to competitor');
  await page.getByLabel('Actual Close Date').fill('2026-10-15'); await reasons.selectOption({label:'Existing customer expansion'});
  await page.getByLabel('Outcome Notes (optional)').fill('Expanded existing deployment\nto another 40 locations.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`test-results/outcome-edit-${width}.png`,fullPage:true}); await saveForm(page);
  await expect(page.getByRole('region',{name:'Opportunity outcome'})).toContainText('2026-10-15'); await expect(page.getByRole('region',{name:'Opportunity outcome'})).toContainText('40 locations.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`test-results/outcome-detail-${width}.png`,fullPage:true});
  await page.goto(`/opportunities/${f.id}/edit`); await page.getByLabel('Sales stage *').selectOption(String(openId));
  await expect(page.getByText('Saving will reopen this Opportunity', {exact:false})).toBeVisible(); await saveForm(page);
  await expect(page.getByRole('region',{name:'Opportunity outcome'})).toHaveCount(0);
  await page.getByText('Opportunity History',{exact:true}).click(); await expect(page.getByText('Opportunity reopened',{exact:true})).toBeVisible(); await expect(page.getByText('Previous closure:',{exact:false})).toContainText('40 locations.');
  await page.goto(`/opportunities/${f.id}/edit`); await page.getByLabel('Sales stage *').selectOption(String(lostId));
  await expect(page.getByLabel('Outcome Reason')).toHaveValue(''); await expect(page.getByLabel('Outcome Notes (optional)')).toHaveValue('');
  await expect(page.getByLabel('Outcome Reason')).toContainText('Lost to competitor'); await expect(page.getByLabel('Outcome Reason')).not.toContainText('Existing customer expansion');
  await page.getByRole('button',{name:'Save opportunity',exact:true}).click(); await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel('Outcome Reason').selectOption({label:'Price'}); await page.getByLabel('Actual Close Date').fill('');
  await page.getByRole('button',{name:'Save opportunity',exact:true}).click(); await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel('Actual Close Date').fill('2026-10-16'); await saveForm(page);
  await expect(page.getByRole('region',{name:'Opportunity outcome'})).toContainText('Closed Lost');
  expect((await db.opportunity.findUniqueOrThrow({where:{id:f.id}})).expectedCloseDate?.toISOString()).toBe('2027-03-31T12:00:00.000Z');
});

test('Admin reason management UI and effective-role access remain restricted',async({page,context})=>{
  test.setTimeout(120_000);
  await signInAs(page,'admin'); await page.goto('/administration/outcome-reasons');
  const add=page.locator('form').first(), name=uniqueName('Admin outcome');
  await add.getByLabel('Name',{exact:true}).fill(name); await add.getByLabel('Close state').selectOption('lost'); await add.getByLabel('Sort order').fill('50'); await add.getByRole('button',{name:'Add',exact:true}).click(); await expect(add.getByRole('status')).toContainText('added');
  for(const width of [1440,768,390]) {await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  const added = await db.outcomeReason.findFirstOrThrow({where:{name}}); const form=page.locator('form').filter({has:page.locator(`#outcomeReason-${added.id}-name`)}); await form.getByLabel('Name',{exact:true}).fill(`${name} revised`); await form.getByLabel('Active',{exact:true}).uncheck(); await form.getByRole('button',{name:'Save',exact:true}).click(); await expect(form.getByRole('status')).toContainText('updated');
  for(const role of ['sales','salesManager','marketing','readOnly','support'] as const) {await signInAs(page,role); await page.goto('/administration/outcome-reasons'); await expect(page).toHaveURL(/access-denied/);}
  if(process.env.ENABLE_DEV_IMPERSONATION==='true') {await signInAs(page,'admin');await context.addCookies([{name:'saleshub-dev-impersonate-user',value:String(sales.id),url:baseURL}]);await page.goto('/administration/outcome-reasons');await expect(page).toHaveURL(/access-denied/);}
});
