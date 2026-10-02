import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const req=Module.createRequire(import.meta.url);
const {Prisma}=req('@prisma/client');
const {salesPlanLinePage,salesPlanReportTotals,salesPlanReportLinePage}=req(path.join(root,'lib/sales-plan-queries.ts'));
const actor=(role,id=7)=>({role,id,active:true,archivedAt:null});
const totals={count:80n,annual:new Prisma.Decimal(8000),units:new Prisma.Decimal(800),revenueCount:80n,unitsCount:80n,complete:60n,accounts:12n,q1:new Prisma.Decimal(100),q2:new Prisma.Decimal(200),q3:new Prisma.Decimal(300),q4:new Prisma.Decimal(400)};
const sql=q=>q.sql.replace(/\s+/g,' ');

test('Sales Plan pages are selected in SQL and summaries remain independent of page',async()=>{
  const calls=[];
  const client={
    $queryRaw:async q=>{calls.push(q);if(sql(q).includes('SELECT COUNT(*)::bigint AS count FROM filtered'))return [{count:80n}];if(sql(q).includes('SELECT id FROM filtered'))return [{id:51},{id:52}];return [totals];},
    salesPlan:{findMany:async()=>[{ownerId:7}]},
    salesPlanLine:{findMany:async q=>{assert.deepEqual(q.where.id.in,[51,52]);return [{id:52,account:null,productSku:null,originalAccountText:'Unresolved',originalSkuText:'SKU-X'},{id:51,account:null,productSku:null,originalAccountText:null,originalSkuText:null}];}},
  };
  const f={year:2027,currencyCode:'USD',userId:null,history:false,page:'2',account:'unresolved',sku:'sku',status:'Fully allocated',search:'plan'};
  const result=await salesPlanLinePage(client,actor('SALES'),f);
  assert.equal(result.page,2);assert.equal(result.pages,2);assert.equal(result.count,80);
  assert.deepEqual(result.lines.map(l=>l.id),[51,52]);assert.equal(result.lines[1].originalAccountText,'Unresolved');
  assert.equal(result.summary.annual.toString(),'8000');assert.equal(result.summary.complete,60);assert.equal(result.summary.accounts,12);
  const pageSql=sql(calls[1]);assert.match(pageSql,/LIMIT 50 OFFSET \?/);assert.match(pageSql,/ORDER BY.*revision DESC.*sourceWorksheet/);
  assert.match(pageSql,/LEFT JOIN "Account"/);assert.match(pageSql,/LEFT JOIN "ProductSku"/);
  assert.ok(calls[1].values.includes(50));assert.ok(calls[1].values.includes(7));
  assert.ok(calls[1].values.includes('unresolved'));assert.ok(calls[1].values.includes('sku'));assert.ok(calls[1].values.includes('Fully allocated'));assert.ok(calls[1].values.includes('plan'));
  assert.match(sql(calls[2]),/SUM\("annualPlannedRevenue"\)/);
  assert.match(sql(calls[2]),/plan_status = 'ACTIVE'/);
});

test('first page, permission scope and revision scope are bound in the database query',async()=>{
  const calls=[];
  const client={$queryRaw:async q=>{calls.push(q);return sql(q).includes('SELECT COUNT(*)::bigint AS count FROM filtered')?[{count:80n}]:sql(q).includes('SELECT id FROM filtered')?[{id:1}]:[totals]},salesPlan:{findMany:async()=>[]},salesPlanLine:{findMany:async()=>[{id:1}]}};
  const base={year:2027,currencyCode:'USD',userId:null,history:false,page:'1'};
  const first=await salesPlanLinePage(client,actor('SALES',17),base);
  assert.equal(first.page,1);assert.deepEqual(first.lines.map(l=>l.id),[1]);assert.ok(calls[1].values.includes(0));assert.ok(calls[1].values.includes(17));
  assert.doesNotMatch(sql(calls[0]),/SUPERSEDED/);
  calls.length=0;
  await salesPlanLinePage(client,actor('READ_ONLY'),{...base,history:true});
  assert.match(sql(calls[0]),/SUPERSEDED/);assert.doesNotMatch(sql(calls[0]),/u\.active = true/);
  assert.ok(!calls[0].values.includes(17));
});

test('management rep totals aggregate all lines and detail uses database count and page',async()=>{
  const raw=[];let detailArgs;
  const client={$queryRaw:async q=>{raw.push(q);return [{ownerId:7,...totals}];},salesPlanLine:{count:async q=>{assert.equal(q.where.plan.ownerId,7);assert.equal(q.where.plan.status,'ACTIVE');return 80;},findMany:async q=>{detailArgs=q;return [{id:51,account:null,productSku:null,originalAccountText:'Pending link',originalSkuText:'SKU-X'}];}}};
  const byRep=await salesPlanReportTotals(client,2027,'USD',7);
  assert.equal(byRep.get(7).count,80);assert.equal(byRep.get(7).annual.toString(),'8000');assert.equal(byRep.get(7).complete,60);
  assert.match(sql(raw[0]),/GROUP BY "ownerId"/);
  const detail=await salesPlanReportLinePage(client,2027,'USD',7,'2');
  assert.equal(detail.page,2);assert.equal(detail.pages,2);assert.equal(detail.count,80);
  assert.equal(detailArgs.skip,50);assert.equal(detailArgs.take,50);
  assert.equal(detail.lines[0].account,null);assert.equal(detail.lines[0].productSku,null);
  assert.equal(detailArgs.include.allocations,true);
});
