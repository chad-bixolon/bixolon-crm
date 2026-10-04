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
const {Prisma}=require('@prisma/client');
const {dashboardForecastMovement,dashboardSalesPlanStatus,dashboardMarketingActivity}=require(path.join(root,'lib/dashboard-widgets.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const dec=value=>new Prisma.Decimal(value);
const snapshot=(week,rep,pipeline,bestCase,commit)=>({snapshotWeek:new Date(`${week}T00:00:00Z`),repId:rep,pipeline:dec(pipeline),weightedPipeline:dec(0),bestCase:dec(bestCase),commit:dec(commit),target:null});

test('Forecast Movement compares two captured weeks in own or current team scope and counts distinct slips',async()=>{
  const snapshots=[snapshot('2026-09-21',7,100,40,20),snapshot('2026-09-28',7,130,45,10),snapshot('2026-09-21',8,200,70,50),snapshot('2026-09-28',8,250,80,60)];
  const scopes=[];
  let rawCalls=0;
  const client={user:{findMany:async()=>[{id:7},{id:8}]},forecastSnapshot:{findMany:async({where})=>snapshots.filter(row=>where.repId.in.includes(row.repId))},$queryRaw:async()=>{scopes.push(rawCalls++<2?[7]:[7,8]);return rawCalls%2?[{snapshotWeek:new Date('2026-09-28')},{snapshotWeek:new Date('2026-09-21')}]:[{count:2n}]}};
  const input={year:2026,quarter:'Q3',currencyCode:'USD'};
  const own=await dashboardForecastMovement(client,actor('SALES'),input);
  assert.deepEqual(scopes[0],[7]);assert.equal(own.pipeline.toString(),'30');assert.equal(own.bestCase.toString(),'5');assert.equal(own.commit.toString(),'-10');assert.equal(own.slipped,2);
  const team=await dashboardForecastMovement(client,actor('SALES_MANAGER'),input);
  assert.deepEqual(scopes[2],[7,8]);assert.equal(team.pipeline.toString(),'80');assert.equal(team.commit.toString(),'0');
});

test('Forecast Movement gives empty guidance without two comparable snapshots and skips history query',async()=>{
  let historyCalls=0;
  const client={$queryRaw:async()=>{historyCalls++;return [{snapshotWeek:new Date('2026-09-21')}]}};
  assert.equal(await dashboardForecastMovement(client,actor('SALES'),{year:2026,quarter:'Q3',currencyCode:'USD'}),null);
  assert.equal(historyCalls,1);
});

test('Sales Plan Status uses active plan owners for totals and excludes missing reps',async()=>{
  const observed=[];
  const total=(ownerId,annual,count,complete)=>({ownerId,annual:dec(annual),count:BigInt(count),complete:BigInt(complete),revenueCount:1n,units:dec(0),unitsCount:0n,accounts:0n,q1:dec(0),q2:dec(0),q3:dec(0),q4:dec(0)});
  const targets=[7,8].flatMap(id=>['Q1','Q2','Q3','Q4'].map(q=>({userId:id,quarter:q,targetAmount:dec(id===7?25:50)})));
  const client={user:{findMany:async()=>[{id:7},{id:8},{id:9}]},salesPlan:{findMany:async({where})=>{observed.push(where);return [{ownerId:7},{ownerId:8}]}},salesTarget:{findMany:async({where})=>targets.filter(row=>where.userId.in.includes(row.userId))},$queryRaw:async()=>[total(7,100,4,3),total(8,180,2,2)]};
  const team=await dashboardSalesPlanStatus(client,actor('SALES_MANAGER'),{year:2026,currencyCode:'USD'});
  assert.equal(team.population.missingPlanReps,1);assert.equal(team.population.repsWithPlan,2);
  assert.equal(team.annual.toString(),'280');assert.equal(team.target.toString(),'300');assert.equal(team.difference.toString(),'-20');
  assert.equal(team.incomplete,1);assert.equal(team.outOfSync,1);assert.equal(team.allocationPercent,83);
  assert.equal(observed[0].status,'ACTIVE');
});

test('Sales Plan Status handles own plan and missing plan without totals query',async()=>{
  let totals=0;
  const client={salesPlan:{findMany:async()=>[]},$queryRaw:async()=>{totals++;return []}};
  const missing=await dashboardSalesPlanStatus(client,actor('SALES'),{year:2026,currencyCode:'USD'});
  assert.equal(missing.annual,null);assert.equal(totals,0);
});

test('Sales Plan Status keeps a Sales user on their own active plan and target',async()=>{
  let ownerScope;
  const client={salesPlan:{findMany:async({where})=>{ownerScope=where.ownerId.in;return [{ownerId:7}]}},salesTarget:{findMany:async()=>['Q1','Q2','Q3','Q4'].map(quarter=>({userId:7,quarter,targetAmount:dec(25)}))},$queryRaw:async()=>[{ownerId:7,annual:dec(100),count:4n,complete:4n,revenueCount:1n,units:dec(0),unitsCount:0n,accounts:0n,q1:dec(0),q2:dec(0),q3:dec(0),q4:dec(0)}]};
  const own=await dashboardSalesPlanStatus(client,actor('SALES'),{year:2026,currencyCode:'USD'});
  assert.deepEqual(ownerScope,[7]);assert.equal(own.annual.toString(),'100');assert.equal(own.target.toString(),'100');
  assert.equal(own.difference.toString(),'0');assert.equal(own.allocationPercent,100);assert.equal(own.syncStatus,'In Sync');
});

test('Marketing Activity counts active Campaigns, recent influences, actionable leads, and visible audiences',async()=>{
  const seen={};
  const client={marketingCampaign:{count:async({where})=>{seen.campaigns=where;return 4}},campaignInfluence:{count:async({where})=>{seen.influences=where;return 27}},tradeShowLead:{count:async({where})=>{seen.leads=where;return 8}},marketingAudience:{count:async({where})=>{seen.audiences=where;return 3}}};
  const now=new Date('2026-10-03T15:00:00Z');
  assert.deepEqual(await dashboardMarketingActivity(client,actor('MARKETING_MANAGER'),now),{campaigns:4,influences:27,leads:8,audiences:3});
  assert.equal(seen.campaigns.status,'ACTIVE');assert.equal(seen.influences.occurredAt.gte.toISOString(),'2026-09-26T15:00:00.000Z');
  assert.deepEqual(seen.leads.routing.in,['UNREVIEWED','MARKETING_FOLLOW_UP']);assert.ok(seen.audiences.OR);
  assert.deepEqual(await dashboardMarketingActivity(client,actor('ADMIN'),now),{campaigns:4,influences:27,leads:8,audiences:3});
  await assert.rejects(dashboardMarketingActivity(client,actor('SALES'),now),/Access denied/);
});
