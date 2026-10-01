import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const {Prisma}=require('@prisma/client');
const {attentionBaseWhere,attentionPredicates,classifyAttention,commitActivityCutoff,getForecastAttention}=require(path.join(root,'lib/forecast-attention.ts'));
const {parseSetting,getSettings}=require(path.join(root,'lib/configuration.ts'));
const actor=(role,id=7)=>({role,id,active:true,archivedAt:null});
const now=new Date('2026-10-01T04:30:00Z');
const row=(extra={})=>({id:1,name:'Deal',ownerId:7,forecastCategory:'COMMIT',currencyCode:'USD',expectedCloseDate:null,createdAt:now,participants:[{account:{name:'Account'}}],products:[],activities:[],...extra});

test('attention uses New York calendar dates and directly linked non-archived Opportunity Activity',()=>{
  assert.equal(commitActivityCutoff(now,14).toISOString(),'2026-09-18T04:00:00.000Z');
  assert.equal(commitActivityCutoff(new Date('2026-12-01T17:00:00Z'),14).toISOString(),'2026-11-18T05:00:00.000Z');
  const predicates=attentionPredicates(now,14);
  assert.equal(predicates.STALE_COMMIT.forecastCategory,'COMMIT');
  assert.deepEqual(predicates.STALE_COMMIT.activities.none,{archivedAt:null,activityDate:{gte:commitActivityCutoff(now,14)}});
  assert.equal(predicates.PAST_CLOSE_DATE.expectedCloseDate.lt.toISOString(),'2026-10-01T00:00:00.000Z');
});

test('multiple issues combine once; recent direct Activity clears stale Commit',()=>{
  const result=classifyAttention(row({ownerId:null}),now,14);
  assert.deepEqual(result.issues,['MISSING_CLOSE_DATE','ZERO_VALUE','MISSING_OWNER','STALE_COMMIT']);
  assert.equal(result.account,'Account');
  assert.deepEqual(classifyAttention(row({expectedCloseDate:new Date('2026-09-30T12:00:00Z'),products:[{quantity:2,estimatedUnitPrice:new Prisma.Decimal(50)}],activities:[{activityDate:new Date('2026-09-30T13:00:00Z')}]}),now,14).issues,['PAST_CLOSE_DATE']);
  assert.ok(classifyAttention(row({activities:[{activityDate:new Date('2026-09-17T13:00:00Z')}]}),now,14).issues.includes('STALE_COMMIT'));
});

test('Sales scope stays owned; management scope includes missing owners; query is bounded',async()=>{
  assert.deepEqual(attentionBaseWhere(actor('SALES')).AND[1],{ownerId:7});
  assert.deepEqual(attentionBaseWhere(actor('SALES_MANAGER')).AND[1],{});
  assert.deepEqual(attentionBaseWhere(actor('ADMIN')).AND[1],{});
  assert.deepEqual(attentionBaseWhere(actor('READ_ONLY')).AND[1],{});
  assert.throws(()=>attentionBaseWhere(actor('MARKETING_MANAGER')),/Access denied/);
  const calls=[];
  const db={opportunity:{count:async args=>{calls.push(args);return 1;},findMany:async args=>{calls.push(args);return [row({ownerId:null})];}}};
  const result=await getForecastAttention(db,actor('ADMIN'),{now,days:14,mode:'DASHBOARD'});
  assert.equal(result.total,1);
  assert.equal(result.rows.length,1);
  assert.equal(calls.at(-1).take,64);
  assert.equal(calls.at(-1).skip,0);
  assert.equal(calls.at(-1).select.products.where.archivedAt,null);
  assert.equal(calls.length,7);
  await getForecastAttention(db,actor('READ_ONLY'),{now,days:14,mode:'DETAIL',filters:{page:2}});
  assert.equal(calls.at(-1).take,25);
  assert.equal(calls.at(-1).skip,25);
});

test('Dashboard and Quarterly Forecast expose Best Case and attention without edit actions',()=>{
  const dashboard=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8');
  const forecast=fs.readFileSync(path.join(root,'app/reports/forecast/page.tsx'),'utf8');
  assert.match(dashboard,/\['Best Case',money\(forecast\.bestCase/);
  assert.match(dashboard,/FORECAST_ATTENTION/);
  assert.match(forecast,/Forecast Attention/);
  assert.match(forecast,/Gap to Commit/);
  assert.doesNotMatch(forecast,/saveOpportunity|updateOpportunity/);
});

test('Commit threshold is Admin-configurable within 1–90 days and defaults to 14',async()=>{
  assert.equal(parseSetting('COMMIT_FOLLOW_UP_DAYS','1'),1);
  assert.equal(parseSetting('COMMIT_FOLLOW_UP_DAYS','90'),90);
  assert.throws(()=>parseSetting('COMMIT_FOLLOW_UP_DAYS','0'));
  assert.throws(()=>parseSetting('COMMIT_FOLLOW_UP_DAYS','91'));
  assert.equal((await getSettings({systemSetting:{findMany:async()=>[]}})).COMMIT_FOLLOW_UP_DAYS,14);
});
