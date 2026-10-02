import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const req=Module.createRequire(import.meta.url);
const { Prisma }=req('@prisma/client');
const { formatPlanCurrency, formatPlanNumber, formatPlanPercent }=req(path.join(root,'lib/display-format.ts'));
const { formatAllocationInput, normalizeAllocationInput, sumAllocation }=req(path.join(root,'lib/sales-plan-allocation.ts'));
const { saveLineAllocation }=req(path.join(root,'lib/sales-plan.ts'));

test('allocation inputs group revenue and units without losing decimal precision',()=>{
  assert.equal(formatAllocationInput('250000','revenue'),'250,000');
  assert.equal(formatAllocationInput('1000000.00','revenue'),'1,000,000');
  assert.equal(formatAllocationInput('1312000','revenue'),'1,312,000');
  assert.equal(formatAllocationInput('7100000.50','revenue'),'7,100,000.50');
  assert.equal(formatAllocationInput('8000.000','units'),'8,000');
  assert.equal(formatAllocationInput('20000','units'),'20,000');
  assert.equal(formatAllocationInput('8000.125','units'),'8,000.125');
  assert.equal(normalizeAllocationInput('1,312,000.50'),'1312000.50');
  assert.equal(normalizeAllocationInput('1,32,000'),'1,32,000');
});

test('plan totals, currency and percentages omit unnecessary zeros',()=>{
  assert.equal(formatPlanNumber(new Prisma.Decimal('8000.000')),'8,000');
  assert.equal(formatPlanNumber(new Prisma.Decimal('8000.125')),'8,000.125');
  assert.equal(formatPlanNumber(null),'—');
  assert.equal(formatPlanNumber('0'),'0');
  assert.equal(formatPlanCurrency(new Prisma.Decimal('1000000.00'),'USD'),'$1,000,000');
  assert.equal(formatPlanCurrency('7100000.50','USD'),'$7,100,000.50');
  assert.equal(formatPlanCurrency('999999999999999.99','USD'),'$999,999,999,999,999.99');
  assert.equal(formatPlanPercent(100),'100%');
  assert.equal(formatPlanPercent(75),'75%');
  assert.equal(formatPlanPercent(12.5),'12.5%');
  const values=Object.fromEntries(['Q1','Q2','Q3','Q4'].map(q=>[q,{units:'',revenue:''}]));
  assert.equal(formatPlanNumber(sumAllocation(values,'units',3)),'0');
  const editor=fs.readFileSync(path.join(root,'app/sales-plan/allocation-editor.tsx'),'utf8');
  assert.match(editor,/value===null\?'—'/);
});

test('formatted submissions save numerically identical Decimal values',async()=>{
  const writes=[];
  const client={salesPlanLine:{findUnique:async()=>({id:5,annualPlannedUnits:new Prisma.Decimal('8000.125'),annualPlannedRevenue:new Prisma.Decimal('7100000.50'),plan:{status:'ACTIVE',ownerId:7,owner:{active:true,archivedAt:null,role:'SALES'}}})},salesPlanQuarterAllocation:{upsert:async x=>writes.push(x)},$transaction:async fn=>fn(client)};
  const quarters=Object.fromEntries(['Q1','Q2','Q3','Q4'].map(q=>[q,{units:'',revenue:''}]));
  quarters.Q1={units:normalizeAllocationInput('8,000.125'),revenue:normalizeAllocationInput('7,100,000.50')};
  await saveLineAllocation(client,{id:7,role:'SALES',active:true,archivedAt:null},{lineId:5,quarters});
  assert.equal(writes[0].create.plannedUnits.toString(),'8000.125');
  assert.equal(writes[0].create.plannedRevenue.toString(),'7100000.5');
  assert.ok(writes[0].create.plannedRevenue.equals(new Prisma.Decimal('7100000.50')));
});
