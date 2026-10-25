import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { can, predefinedCapabilities, routeAccess } = require('../lib/authorization.ts');
const { eligibleUser, eligibilityRoles } = require('../lib/assignment-eligibility.ts');
const { saveUser, parseUser, assertUserAdministrationTarget } = require('../lib/users.ts');
const { userChangeImpact, UserImpactRequired } = require('../lib/user-lifecycle.ts');
const { isUserTimeZone } = require('../lib/user-time-zone.ts');
const actor = role => ({ id: 1, role, active: true, archivedAt: null });
const admin = actor('ADMIN'), delegated = { ...actor('SALES_MANAGER'), delegatedUserAdministrationEnabled: true };
const trap = new Proxy({}, { get() { throw new Error('Unexpected database access'); } });
test('Executive cannot read negotiated pricing through shared reports or report execution', async () => {
  const reporting = require('../lib/reporting.ts');
  const executive = actor('EXECUTIVE');
  assert.equal(reporting.canRunReportType(executive, 'PRICE_EXCEPTION_USAGE'), false);
  assert.equal(reporting.canViewReportDefinition(executive, {ownerId:2,visibility:'SHARED',reportType:'PRICE_EXCEPTION_USAGE'}), false);
  assert.equal(reporting.canViewBuiltInReport(executive, 'PE_USAGE_THIS_QUARTER'), false);
  await assert.rejects(reporting.executePriceExceptionUsageReport(trap, executive, {}), /Access denied/);
  assert.equal(routeAccess('/reports/new', executive), 'allowed');
  assert.equal(reporting.canCreateReport(executive), false);
  const {canReadOpportunitySnapshotHistory} = require('../lib/opportunity-snapshots.ts');
  for (const role of ['ADMIN','SALES_MANAGER','SALES','EXECUTIVE']) assert.equal(canReadOpportunitySnapshotHistory(actor(role)), true);
  for (const role of ['READ_ONLY','SUPPORT','SUPPORT_MANAGER','MARKETING_MANAGER']) assert.equal(canReadOpportunitySnapshotHistory(actor(role)), false);
});
test('new roles grant only their explicit business capabilities', async () => {
  const support = actor('SUPPORT_MANAGER'), executive = actor('EXECUTIVE');
  for (const p of ['support-cases.read','support-cases.write','support-work.write','support-inbox.write','support-oversight.manage','support-categories.manage']) assert.ok(can(support,p),p);
  for (const p of ['support-mailbox.manage','users.manage','configuration.manage','system-health.read','maintenance.manage','data-quality.manage','sales.write','tasks.write','marketing.write','pricing.read','integrations.manage']) assert.equal(can(support,p),false,p);
  for (const p of ['accounts.read','contacts.read','opportunities.read','sales.read','projects.read','tasks.read','forecast.read','snapshots.read','pipeline-movement.read','sales-plan.read','support-cases.read','marketing.read','trade-shows.read','products.read','demos.read']) assert.ok(can(executive,p),p);
  for (const p of predefinedCapabilities.EXECUTIVE) assert.ok(p.endsWith('.read'));
  for (const who of [support,executive]) await assert.rejects(saveUser(trap,who,{role:'ADMIN'}),/Access denied/);
  assert.equal(routeAccess('/support/inbox', executive),'denied');
  assert.equal(routeAccess('/administration/system-health',support),'denied');
});
test('delegation grants only user administration and cannot elevate administrative identities', () => {
  for (const permission of predefinedCapabilities.ADMIN) assert.equal(can(delegated,permission),['users.manage','users.export'].includes(permission)||predefinedCapabilities.SALES_MANAGER.includes(permission),permission);
  for (const policy of Object.keys(eligibilityRoles)) assert.equal(eligibleUser(delegated,policy),eligibleUser(actor('SALES_MANAGER'),policy));
  for (const role of ['ADMIN','SALES_MANAGER']) assert.throws(()=>assertUserAdministrationTarget(delegated,null,{role,delegatedUserAdministrationEnabled:true}),/Only an Administrator/);
  assert.throws(()=>assertUserAdministrationTarget(delegated,admin,{role:'SALES'}),/Only an Administrator/);
  assert.throws(()=>assertUserAdministrationTarget(delegated,delegated,{role:'SALES'}),/Only an Administrator/);
  assertUserAdministrationTarget(delegated,null,{role:'EXECUTIVE'});
  assert.equal(can({...delegated,active:false},'users.manage'),false);
  assert.equal(can({...delegated,archivedAt:new Date()},'users.manage'),false);
  assert.equal(routeAccess('/administration/settings',delegated),'denied');
  assert.equal(routeAccess('/administration/users',delegated),'allowed');
});
test('individual User edits enforce delegated access eligibility through the shared target policy', () => {
  assert.throws(() => assertUserAdministrationTarget(admin, null, { role: 'SALES_MANAGER', active: false, delegatedUserAdministrationEnabled: true }), /requires an active Sales Manager/);
  assert.throws(() => assertUserAdministrationTarget(admin, null, { role: 'SALES', active: true, delegatedUserAdministrationEnabled: true }), /requires an active Sales Manager/);
  assert.throws(() => assertUserAdministrationTarget(admin, delegated, { role: 'READ_ONLY', active: true }), /requires an active Sales Manager/);
  assertUserAdministrationTarget(admin, delegated, { role: 'READ_ONLY', active: true, delegatedUserAdministrationEnabled: false });
});
test('eligibility separates Support leadership from Sales and excludes all Executive assignments',()=>{
  for(const policy of Object.keys(eligibilityRoles)) {
    assert.equal(eligibleUser(actor('EXECUTIVE'),policy),false,policy);
    assert.equal(eligibleUser(actor('SUPPORT_MANAGER'),policy),['support-case','support-task'].includes(policy),policy);
    assert.equal(eligibleUser({...actor('SUPPORT_MANAGER'),active:false},policy),false);
  }
});
test('impact preview examines lost eligibility only, preserving history and compatible transitions',async()=>{
 const seen=[];
 const db=Object.fromEntries(['account','opportunity','project','task','supportCase','tradeShowLead','tradeShow','priceException','demoRequest','marketingAudience','reportDefinition'].map(name=>[name,{count:async args=>{seen.push([name,args]);return 2;}}]));
 const next=actor('EXECUTIVE');
 const impact=await userChangeImpact(db,admin,actor('SALES_MANAGER'),next);
 assert.ok(impact.some(row=>row.area==='Open Opportunities'&&row.count===2));
 assert.ok(impact.some(row=>row.area==='Outstanding Demos'));
 assert.ok(impact.some(row=>row.area==='Price Exception follow-up'));
 assert.equal(seen.find(([name])=>name==='opportunity')[1].where.stage.isClosed,false);
 assert.ok((await userChangeImpact(db,admin,actor('SALES'),actor('READ_ONLY'))).length);
 assert.ok((await userChangeImpact(db,admin,actor('SUPPORT'),{...actor('SUPPORT'),active:false})).some(row=>row.area==='Unresolved Support Cases'));
 assert.deepEqual(await userChangeImpact(trap,admin,actor('SUPPORT'),actor('SUPPORT_MANAGER')),[]);
});
test('Unicode names and international IANA zones validate without changing default business timezone',()=>{
 const form=new FormData();for(const [key,value] of Object.entries({firstName:'민준',lastName:'김',email:'person@example.com',role:'EXECUTIVE',active:'true',timeZone:'Asia/Seoul'}))form.set(key,value);
 assert.equal(parseUser(form).value.firstName,'민준');
 for(const zone of ['Asia/Seoul','Europe/London','Pacific/Auckland','UTC'])assert.ok(isUserTimeZone(zone));
 for(const zone of ['Mars/City','+09:00','',null])assert.equal(isUserTimeZone(zone),false);
});
test('save refuses stale delegation before persistence and records approved changes atomically',async()=>{
 let target={...actor('SALES'),id:2,firstName:'A',lastName:'B',email:'a@example.test',timeZone:'Asia/Seoul',delegatedUserAdministrationEnabled:false};
 const history=[];let writes=0;
 const tx={$queryRaw:async()=>[],user:{findUnique:async({where})=>where.id===1?admin:target,update:async({data})=>{writes++;target={...target,...data};return target;}},adminMaintenanceEvent:{create:async({data})=>history.push(data)}};
 for(const model of ['account','opportunity','project','task','tradeShowLead','priceException','demoRequest','marketingAudience','reportDefinition'])tx[model]={count:async()=>model==='opportunity'?4:0};
 const db={$transaction:fn=>fn(tx)};
 const next={...target,role:'EXECUTIVE'};
 let warning;try{await saveUser(db,admin,next,2);}catch(error){warning=error;}
 assert.ok(warning instanceof UserImpactRequired);assert.equal(writes,0);
 await saveUser(db,admin,next,2,warning.confirmation);
 assert.equal(writes,1);assert.ok(history.some(row=>row.action==='Role changed'&&row.oldValue==='SALES'&&row.newValue==='EXECUTIVE'));
 tx.user.findUnique=async()=>({...delegated,delegatedUserAdministrationEnabled:false});
 await assert.rejects(saveUser(db,delegated,next,2),/Access denied/);
});
