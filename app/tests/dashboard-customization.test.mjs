import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const dashboard=require(path.join(root,'lib/dashboard.ts'));
const reporting=require(path.join(root,'lib/reporting.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const config=reporting.defaultReportConfiguration('PIPELINE');

function client({personal=null,roleLayout=null,reports=[]}={}){return {
  userDashboardLayout:{findUnique:async()=>personal},
  roleDashboardLayout:{findUnique:async()=>roleLayout},
  reportDefinition:{findMany:async({where})=>reports.filter(report=>where.id.in.includes(report.id))},
};}

test('system defaults are role-specific and Marketing remains sales-pipeline safe',()=>{
  assert.ok(dashboard.systemDashboardDefaults.SALES.items.some(item=>item.key==='FORECAST_SUMMARY'));
  assert.ok(dashboard.systemDashboardDefaults.SALES_MANAGER.items.some(item=>item.key==='PIPELINE_BY_REP'));
  assert.deepEqual(dashboard.systemDashboardDefaults.MARKETING_MANAGER.items.map(item=>item.key),['MARKETING_SUMMARY','OVERDUE_TASKS']);
  assert.equal(dashboard.canUseDashboardWidget(actor('MARKETING_MANAGER'),'FORECAST_SUMMARY'),false);
  assert.equal(dashboard.canUseDashboardWidget(actor('SALES'),'PIPELINE_BY_REP'),false);
});

test('layout validation preserves order and rejects unknown, unauthorized, duplicate, and invalid-size widgets',async()=>{
  const db=client();
  const valid=await dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'OVERDUE_TASKS',size:'HALF'},{kind:'BUILTIN',key:'FORECAST_SUMMARY',size:'FULL'}]});
  assert.deepEqual(valid.items.map(item=>item.key),['OVERDUE_TASKS','FORECAST_SUMMARY']);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'NOPE',size:'HALF'}]}),/Unknown/);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'PIPELINE_BY_REP',size:'HALF'}]}),/not available/);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'FORECAST_SUMMARY',size:'HALF'}]}),/size/);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'OVERDUE_TASKS',size:'HALF'},{kind:'BUILTIN',key:'OVERDUE_TASKS',size:'FULL'}]}),/only appear once/);
});

test('Saved Report pins enforce ownership, visibility, report type, grouping, and caps',async()=>{
  const personal={id:10,name:'Mine',ownerId:7,visibility:'PERSONAL',reportType:'PIPELINE',archivedAt:null,configuration:config};
  const other={...personal,id:11,name:'Other',ownerId:8};
  const shared={...other,id:12,visibility:'SHARED'};
  const db=client({reports:[personal,other,shared]});
  const item=id=>({kind:'SAVED_REPORT',reportId:id,size:'HALF',style:'KPI'});
  assert.equal((await dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[item(10)]})).items[0].reportId,10);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[item(11)]}),/unavailable/);
  assert.equal((await dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[item(12)]})).items[0].reportId,12);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{...item(10),style:'GROUPED_SUMMARY'}]}),/requires a grouped/);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:Array.from({length:9},(_,index)=>item(index+20))}),/at most 8/);
});

test('personal override wins, reset inheritance remains implicit, and a role change falls back',async()=>{
  const personal={role:'SALES',configuration:{version:1,items:[{kind:'BUILTIN',key:'OVERDUE_TASKS',size:'FULL'}]}};
  const roleLayout={configuration:{version:1,items:[{kind:'BUILTIN',key:'PIPELINE_BY_STAGE',size:'HALF'}]}};
  let result=await dashboard.getEffectiveDashboardLayout(client({personal,roleLayout}),actor('SALES'));
  assert.equal(result.personalized,true);assert.equal(result.configuration.items[0].key,'OVERDUE_TASKS');
  result=await dashboard.getEffectiveDashboardLayout(client({personal:null,roleLayout}),actor('SALES'));
  assert.equal(result.personalized,false);assert.equal(result.configuration.items[0].key,'PIPELINE_BY_STAGE');
  result=await dashboard.getEffectiveDashboardLayout(client({personal,roleLayout:null}),actor('MARKETING_MANAGER'));
  assert.equal(result.personalized,false);assert.deepEqual(result.configuration.items.map(item=>item.key),['MARKETING_SUMMARY','OVERDUE_TASKS']);
});

test('Dashboard UI exposes responsive spans and keyboard reorder controls',()=>{
  const page=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8'),editor=fs.readFileSync(path.join(root,'components/dashboard-editor.tsx'),'utf8');
  assert.match(page,/lg:grid-cols-2/);assert.match(page,/lg:col-span-2/);
  assert.match(editor,/Move .* up/);assert.match(editor,/Move .* down/);assert.match(editor,/Save Dashboard|submitLabel/);
  assert.match(editor,/Half/);assert.match(editor,/Full/);
});
