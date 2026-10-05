import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const exp=require(path.join(root,'lib/price-exception-expiration.ts'));
const {priceExceptionWhere}=require(path.join(root,'lib/price-exceptions.ts'));
const {expiringWorkbook}=require(path.join(root,'lib/price-exception-expiration-workbook.ts'));
const actor=role=>({id:7,role,active:true,archivedAt:null});
const today=new Date('2026-10-05T00:00:00Z');
const date=offset=>exp.addDays(today,offset);

test('New York business date holds through UTC midnight and DST boundaries',()=>{
  assert.equal(exp.businessToday(new Date('2026-10-05T02:00:00Z')).toISOString(),'2026-10-04T00:00:00.000Z');
  assert.equal(exp.businessToday(new Date('2026-11-01T04:30:00Z')).toISOString(),'2026-11-01T00:00:00.000Z');
  assert.equal(exp.businessToday(new Date('2026-11-01T06:30:00Z')).toISOString(),'2026-11-01T00:00:00.000Z');
});
test('expiration display boundaries are exclusive, with no date separate',()=>{
  assert.deepEqual([-1,0,30,31,60,61,90,91].map(n=>exp.expirationState(date(n),today)),['Expired','0–30 Days','0–30 Days','31–60 Days','31–60 Days','61–90 Days','61–90 Days','Future expiration']);
  assert.equal(exp.expirationState(null,today),'No expiration');
  assert.equal(exp.daysUntilExpiration(date(-1),today),-1);
});
test('query windows are calendar date based and status combines independently',()=>{
  assert.deepEqual(exp.expirationWhere('next30',today),{expirationDate:{gte:today,lt:date(31)}});
  assert.deepEqual(exp.expirationWhere('next60',today),{expirationDate:{gte:today,lt:date(61)}});
  assert.deepEqual(exp.expirationWhere('next90',today),{expirationDate:{gte:today,lt:date(91)}});
  assert.deepEqual(exp.expirationWhere('follow-up',today),{expirationDate:{lt:date(91)}});
  assert.deepEqual(exp.expirationWhere('none',today),{expirationDate:null});
  const active=JSON.stringify(exp.expiringWhere(actor('SALES'),{expiration:'expired',status:'ACTIVE'},today));
  const inactive=JSON.stringify(exp.expiringWhere(actor('SALES'),{expiration:'expired',status:'EXPIRED'},today));
  assert.match(active,/"ACTIVE"/);assert.match(inactive,/"EXPIRED"/);assert.match(active,/LEGACY_WORKBOOK/);
  assert.match(JSON.stringify(exp.expiringWhere(actor('ADMIN'),{expiration:'expired',status:'ARCHIVED'},today)),/"archivedAt"/);
  assert.match(JSON.stringify(priceExceptionWhere({status:'ACTIVE',expiration:'expired'},new Date('2026-10-05T18:00:00Z'))),/2026-10-05T00:00:00.000Z/);
});
test('dashboard buckets are mutually exclusive and enforce PE visibility',async()=>{
  const calls=[];const db={priceException:{count:async({where})=>{calls.push(where);return calls.length;}}};
  const counts=await exp.expiringDashboardCounts(db,actor('SALES'),new Date('2026-10-05T18:00:00Z'));
  assert.deepEqual(counts,{'expired':1,'0-30':2,'31-60':3,'61-90':4});
  assert.match(JSON.stringify(calls[0]),/LEGACY_WORKBOOK/);
  assert.deepEqual(calls[1].AND[1],{expirationDate:{gte:today,lt:date(31)}});
  assert.deepEqual(calls[2].AND[1],{expirationDate:{gte:date(31),lt:date(61)}});
  await assert.rejects(exp.expiringDashboardCounts(db,actor('MARKETING_MANAGER')), /Access denied/);
});
test('report pages and export use identical where and preserve date and number cells',async()=>{
  const queries=[];const record={id:4,peCode:'PE-4',sourceType:'EXTERNAL_EXPORT',assignedSalesRepUser:{firstName:'A',lastName:'Rep'},distributorAccount:{name:'Acme'},varAccount:null,endUserAccount:null,distributorSourceName:null,varSourceName:null,endUserSourceName:null,status:'ACTIVE',expirationDate:date(30),lines:[]};
  const db={priceException:{count:async({where})=>{queries.push(where);return 1;},findMany:async args=>{queries.push(args.where);return [record];}}};
  const filters={expiration:'next30',status:'ACTIVE',q:'PE-4',account:'Acme',sku:'SKU',salesRep:'7'};
  const page=await exp.expiringReport(db,actor('ADMIN'),filters,{now:new Date('2026-10-05T18:00:00Z')});
  const exported=await exp.expiringReport(db,actor('ADMIN'),filters,{all:true,now:new Date('2026-10-05T18:00:00Z')});
  assert.deepEqual(queries[0],queries[1]);assert.deepEqual(queries[0],queries[2]);
  assert.equal(page.rows[0].days,30);assert.equal(exported.rows[0].id,page.rows[0].id);
  const book=expiringWorkbook(exported,filters,'A Rep');const sheet=book.Sheets['Expiring Price Exceptions'];
  assert.equal(sheet.F9.t,'d');assert.equal(sheet.G9.t,'n');assert.equal(sheet.G9.v,30);
  const empty=expiringWorkbook({...exported,rows:[],count:0},filters,'A Rep');assert.match(empty.Sheets['Expiring Price Exceptions'].A9.v,/No Price Exceptions/);
});
