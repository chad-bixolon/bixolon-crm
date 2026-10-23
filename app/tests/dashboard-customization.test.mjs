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
  assert.ok(dashboard.systemDashboardDefaults.SALES.items.some(item=>item.key==='MY_TRADE_SHOW_LEADS'));
  assert.ok(dashboard.systemDashboardDefaults.SALES_MANAGER.items.some(item=>item.key==='PIPELINE_BY_REP'));
  assert.deepEqual(dashboard.systemDashboardDefaults.MARKETING_MANAGER.items.map(item=>item.key),['MARKETING_ACTIVITY','MARKETING_SUMMARY','OVERDUE_TASKS']);
  assert.ok(dashboard.systemDashboardDefaults.SALES_MANAGER.items.some(item=>item.key==='FORECAST_MOVEMENT'));
  assert.ok(dashboard.systemDashboardDefaults.ADMIN.items.some(item=>item.key==='ADMIN_DATA_QUALITY'));
  assert.ok(!dashboard.systemDashboardDefaults.ADMIN.items.some(item=>item.key==='MARKETING_ACTIVITY'));
  assert.equal(dashboard.canUseDashboardWidget(actor('ADMIN'),'MARKETING_ACTIVITY'),true);
  assert.equal(dashboard.canUseDashboardWidget(actor('SALES'),'MARKETING_ACTIVITY'),false);
  assert.equal(dashboard.canUseDashboardWidget(actor('READ_ONLY'),'SALES_PLAN_STATUS'),false);
  assert.equal(dashboard.canUseDashboardWidget(actor('MARKETING_MANAGER'),'FORECAST_SUMMARY'),false);
  assert.equal(dashboard.canUseDashboardWidget(actor('SALES'),'PIPELINE_BY_REP'),false);
});

test('layout validation preserves order and rejects unknown, unauthorized, duplicate, and invalid-size widgets',async()=>{
  const db=client();
  const requested={version:1,items:[{kind:'BUILTIN',key:'OVERDUE_TASKS',size:'HALF'},{kind:'BUILTIN',key:'FORECAST_SUMMARY',size:'FULL'}]};
  const valid=await dashboard.validateDashboardLayout(db,actor('SALES'),requested);
  assert.deepEqual(valid,requested);
  assert.deepEqual(valid.items.map(item=>item.key),['OVERDUE_TASKS','FORECAST_SUMMARY']);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'NOPE',size:'HALF'}]}),/Unknown/);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'PIPELINE_BY_REP',size:'HALF'}]}),/not available/);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'FORECAST_SUMMARY',size:'HALF'}]}),/size/);
  await assert.rejects(dashboard.validateDashboardLayout(db,actor('SALES'),{version:1,items:[{kind:'BUILTIN',key:'OVERDUE_TASKS',size:'HALF'},{kind:'BUILTIN',key:'OVERDUE_TASKS',size:'FULL'}]}),/only appear once/);
});

test('canonical widget names and presentation sections are shared across Dashboard surfaces',()=>{
  assert.equal(new Set(dashboard.dashboardWidgetKeys).size,dashboard.dashboardWidgetKeys.length);
  const expected={
    FORECAST_SUMMARY:['Forecast Summary','FORECAST'],
    FORECAST_MOVEMENT:['Forecast Movement','FORECAST'],
    SALES_PLAN_STATUS:['Sales Plan Status','FORECAST'],
    PIPELINE_BY_REP:['Sales Rep Forecast','PIPELINE'],
    PIPELINE_BY_STAGE:['Pipeline by Stage','PIPELINE'],
    PIPELINE_BY_PRODUCT_CATEGORY:['Pipeline by Product Category','PIPELINE'],
    CLOSING_OPPORTUNITIES:['Opportunities Closing This Quarter','PIPELINE'],
    STALE_ACCOUNTS:['Accounts with No Activity 90+ Days','ATTENTION'],
    OVERDUE_TASKS:['Tasks Needing Attention','TODAY'],
    RECENT_ACTIVITY:['Recent Activity','ATTENTION'],
    MY_TRADE_SHOW_LEADS:['My Trade Show Leads','ATTENTION'],
    MARKETING_SUMMARY:['Marketing Summary','MARKETING'],
    MARKETING_ACTIVITY:['Marketing Activity','MARKETING'],
    ADMIN_SHORTCUTS:['Administration Shortcuts','ADMINISTRATION'],
  };
  for(const [key,[title,section]] of Object.entries(expected)){
    assert.equal(dashboard.dashboardWidgetRegistry[key].title,title);
    assert.equal(dashboard.dashboardWidgetRegistry[key].presentationSection,section);
  }
  assert.equal(dashboard.dashboardPresentationSectionTitles.FORECAST,'Forecast Summary');
  assert.equal(dashboard.dashboardPresentationSectionTitles.PIPELINE,'Pipeline & Forecast');
  assert.equal(dashboard.dashboardPresentationSectionTitles.ATTENTION,'Attention & Activity');
  assert.equal(dashboard.dashboardItemPresentationSection({kind:'SAVED_REPORT',reportId:4,size:'HALF',style:'KPI'}),'PINNED_REPORTS');
});

test('presentation sections expose only permitted widgets and omit empty unauthorized groups',()=>{
  const marketing=dashboard.availableDashboardWidgets(actor('MARKETING_MANAGER'));
  assert.deepEqual(marketing.map(widget=>widget.key),['OVERDUE_TASKS','MARKETING_SUMMARY','MARKETING_ACTIVITY']);
  assert.deepEqual(new Set(marketing.map(widget=>widget.presentationSection)),new Set(['MARKETING','TODAY']));
  assert.equal(marketing.some(widget=>widget.presentationSection==='PIPELINE'||widget.presentationSection==='ADMINISTRATION'),false);
  const sales=dashboard.availableDashboardWidgets(actor('SALES'));
  assert.equal(sales.some(widget=>widget.presentationSection==='MARKETING'||widget.presentationSection==='ADMINISTRATION'),false);
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
  assert.equal(result.personalized,false);assert.deepEqual(result.configuration.items.map(item=>item.key),['MARKETING_ACTIVITY','MARKETING_SUMMARY','OVERDUE_TASKS']);
});

test('Marketing default is balanced and unavailable personal report pins are removed',async()=>{
  const defaults=dashboard.systemDashboardDefaults.MARKETING_MANAGER.items;
  assert.deepEqual(defaults.map(item=>[item.key,item.size]),[['MARKETING_ACTIVITY','FULL'],['MARKETING_SUMMARY','FULL'],['OVERDUE_TASKS','HALF']]);
  assert.equal(dashboard.dashboardItemPresentationSection(defaults[0]),'MARKETING');
  assert.equal(dashboard.dashboardItemPresentationSection(defaults[1]),'MARKETING');
  assert.equal(dashboard.dashboardItemPresentationSection(defaults[2]),'TODAY');
  const personal={role:'MARKETING_MANAGER',configuration:{version:1,items:[...defaults,{kind:'SAVED_REPORT',reportId:999,size:'HALF',style:'KPI'}]}};
  const result=await dashboard.getEffectiveDashboardLayout(client({personal}),actor('MARKETING_MANAGER'));
  assert.equal(result.personalized,true);
  assert.deepEqual(result.configuration.items,defaults);
});

test('Dashboard UI exposes responsive spans and keyboard reorder controls',()=>{
  const page=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8'),editor=fs.readFileSync(path.join(root,'components/dashboard-editor.tsx'),'utf8'),admin=fs.readFileSync(path.join(root,'app/administration/dashboard-views/page.tsx'),'utf8');
  assert.match(page,/lg:grid-cols-2/);assert.match(page,/lg:col-span-2/);
  assert.match(page,/grid-cols-2 gap-3 xl:grid-cols-4/);
  assert.match(page,/dashboardWidgetRegistry\[item\.key\]\.title/);
  assert.match(page,/dashboardPresentationSectionTitles\[group\.section\]/);
  assert.match(page,/composeDashboardSections\(visibleItems\)/);
  assert.match(editor,/Move .* up/);assert.match(editor,/Move .* down/);assert.match(editor,/Save Dashboard|submitLabel/);
  assert.match(editor,/Half/);assert.match(editor,/Full/);
  assert.match(editor,/Dashboard Sections/);
  assert.match(editor,/Choose which items appear, set their order, and select their size\./);
  assert.match(editor,/No additional widgets are available for this role\./);
  assert.match(editor,/dashboardPresentationSectionTitles\[group\.section\]/);
  assert.match(editor,/composeDashboardSections\(items\)/);
  assert.match(admin,/widgets=\{availableDashboardWidgets\(target\)\.filter\(widget=>dashboardWidgetAvailable\(widget.key,availability\)\)\}/);
  for(const inconsistent of ['Pipeline by Sales Rep','Sales rep forecast','Closing Opportunities','Stale Accounts','Recent Activities']){
    assert.equal(page.includes(inconsistent),false);
    assert.equal(editor.includes(inconsistent),false);
  }
});


test('all six audiences use permitted shared compositions with primary work first',async()=>{
  const expected={
    SALES:['MY_DAY','OVERDUE_TASKS','CLOSING_OPPORTUNITIES','FORECAST_SUMMARY','PIPELINE_BY_STAGE','FORECAST_ATTENTION','MY_TRADE_SHOW_LEADS','RECENT_ACTIVITY'],
    SALES_MANAGER:['FORECAST_SUMMARY','PIPELINE_BY_REP','PIPELINE_BY_STAGE','CLOSING_OPPORTUNITIES','FORECAST_ATTENTION','RECENT_ACTIVITY','FORECAST_MOVEMENT','OVERDUE_TASKS','MY_DAY'],
    SUPPORT:['SUPPORT_MY_OPEN','SUPPORT_INTAKE','SUPPORT_PRIORITY','SUPPORT_OVERDUE','SUPPORT_TASKS','SUPPORT_OLDEST','SUPPORT_ACTIVITY'],
    ADMIN:['ADMIN_DATA_QUALITY','ADMIN_HEALTH','ADMIN_SHORTCUTS'],
    MARKETING_MANAGER:['MARKETING_ACTIVITY','MARKETING_SUMMARY','OVERDUE_TASKS'],
    READ_ONLY:['FORECAST_SUMMARY','PIPELINE_BY_STAGE'],
  };
  for(const [role,keys] of Object.entries(expected)){
    const layout=(await dashboard.getEffectiveDashboardLayout(client(),actor(role))).configuration;
    assert.deepEqual(layout.items.map(item=>item.key),keys);
    assert.deepEqual(await dashboard.validateDashboardLayout(client(),actor(role),layout),layout);
    assert.deepEqual(dashboard.composeDashboardSections(layout.items).flatMap(group=>group.items),layout.items);
  }
  assert.equal(dashboard.availableDashboardWidgets(actor('SUPPORT')).some(widget=>widget.section==='forecast'||widget.key==='MY_DAY'),false);
  for(const role of ['SUPPORT','MARKETING_MANAGER','READ_ONLY']){
    assert.equal(dashboard.canUseDashboardWidget(actor(role),'ADMIN_HEALTH'),false);
    assert.equal(dashboard.canUseDashboardWidget(actor(role),'ADMIN_DATA_QUALITY'),false);
  }
  assert.equal(dashboard.canUseDashboardWidget({...actor('ADMIN'),active:false},'ADMIN_HEALTH'),false);
});

test('composition preserves cross-section moves, reports, and empty layouts',()=>{
  const items=[dashboard.systemDashboardDefaults.SALES.items[0],dashboard.systemDashboardDefaults.SALES.items[3],dashboard.systemDashboardDefaults.SALES.items[1],{kind:'SAVED_REPORT',reportId:10,size:'HALF',style:'KPI'}];
  const groups=dashboard.composeDashboardSections(items);
  assert.deepEqual(groups.map(group=>group.section),['TODAY','FORECAST','TODAY','PINNED_REPORTS']);
  assert.deepEqual(groups.flatMap(group=>group.items),items);
  assert.deepEqual(dashboard.composeDashboardSections([]),[]);
});
