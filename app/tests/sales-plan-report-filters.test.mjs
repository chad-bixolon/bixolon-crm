import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=Module.createRequire(import.meta.url);
const originalLoad=Module._load;
Module._extensions['.tsx']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const prisma={
  salesPlan:{findMany:async()=>[]},
  user:{findMany:async()=>[{id:7,firstName:'Alex',lastName:'Rivera'}]},
  currency:{findMany:async()=>[{code:'USD'},{code:'EUR'}]},
  productSku:{findMany:async()=>[]},
  account:{findMany:async()=>[]},
};
Module._load=function(request,parent,isMain){
  if(request==='next/link')return {__esModule:true,default:({href,children,...props})=>React.createElement('a',{href,...props},children)};
  if(request==='@/components/shell')return {Content:({children})=>React.createElement('main',null,children),PageHeader:({title,action})=>React.createElement('header',null,React.createElement('h1',null,title),action)};
  if(request==='@/lib/current-user')return {currentUser:async()=>({id:1,role:'ADMIN'})};
  if(request==='@/lib/prisma')return {prisma};
  if(request==='@/lib/assignment-eligibility')return {activeSalesRepWhere:()=>({})};
  if(request==='@/lib/sales-plan')return {annualTargetFromRows:()=>({}),allocationSummary:()=>({status:''}),planForecast:async()=>[]};
  if(request==='@/lib/display-format')return {formatPlanCurrency:String,formatPlanNumber:String,formatPlanPercent:String};
  if(request==='@/lib/forecast')return {quarters:['Q1','Q2','Q3','Q4']};
  if(request==='@/lib/sales-plan-queries')return {salesPlanReportTotals:async()=>new Map(),salesPlanReportLinePage:async()=>null,salesPlanPopulation:()=>({ownerIds:[],missingPlanReps:0,activeSalesReps:1})};
  if(request==='@/lib/sales-target-sync')return {targetSyncStatus:()=>''};
  if(request==='@/lib/sales-plan-export')return {exportAccess:()=>true};
  if(request==='@/lib/sales-plan-sku-rollup')return {allocationPercent:()=>null,rollupAccess:()=>true,salesPlanSkuRollup:async()=>({rows:[],lines:[],unresolved:[],summary:{skuCount:0,units:null,revenue:null,accountCount:0,unresolvedLines:0,allocated:{units:null,revenue:null},exactLines:0}}),skuContributions:()=>[]};
  return originalLoad.call(this,request,parent,isMain);
};
const SalesPlan=require(path.join(root,'app/reports/sales-plan/page.tsx')).default;
const SkuRollup=require(path.join(root,'app/reports/sales-plan-sku/page.tsx')).default;
Module._load=originalLoad;

test('Sales Plan report renders a compact responsive filter row and scoped actions',async()=>{
  const html=renderToStaticMarkup(await SalesPlan({searchParams:Promise.resolve({year:'2027',currencyCode:'EUR',userId:'7'})}));
  const form=html.match(/<form[^>]*aria-label="Filter Sales Plan report"[^>]*>.*?<\/form>/)?.[0];
  assert.ok(form);
  assert.match(form,/class="panel filter-panel filter-grid sales-plan-report-filters mb-5"/);
  for(const name of ['year','currencyCode','userId'])assert.match(form,new RegExp(`name="${name}"`));
  assert.equal((form.match(/class="field filter-control"/g)??[]).length,3);
  assert.match(form,/<div class="filter-actions"><button class="btn-filter-primary w-full sm:w-auto"[^>]*>View report<\/button><\/div>/);
  assert.match(html,/href="\/reports\/sales-plan\/export\?year=2027&amp;currencyCode=EUR&amp;userId=7" class="btn-primary">Export Excel<\/a>/);
  assert.match(html,/href="\/sales-plan" class="btn-secondary">Sales Plan<\/a>/);
  assert.doesNotMatch(form,/name="page"|action="/);
});

test('SKU Rollup keeps its filters and routes with an orange View report action',async()=>{
  const html=renderToStaticMarkup(await SkuRollup({searchParams:Promise.resolve({year:'2027',currencyCode:'EUR',userId:'7',search:'printer'})}));
  const form=html.match(/<form[^>]*method="get"[^>]*>.*?<\/form>/)?.[0];
  assert.ok(form);
  for(const name of ['year','currencyCode','userId','productId','skuId','accountId','search'])assert.match(form,new RegExp(`name="${name}"`));
  assert.match(form,/sm:grid-cols-3 xl:grid-cols-4/);
  assert.match(form,/<button class="btn-primary w-full sm:w-auto"[^>]*>View report<\/button>/);
  assert.match(html,/href="\/reports\/sales-plan-sku\/export\?year=2027&amp;currencyCode=EUR&amp;userId=7&amp;search=printer"/);
  assert.match(html,/href="\/reports\/sales-plan" class="btn-secondary">Sales Plan report<\/a>/);
});

test('Sales Plan filter widths become a single aligned desktop row',()=>{
  const css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8');
  assert.match(css,/@media \(min-width: 64rem\)\s*\{\s*\.filter-grid\.sales-plan-report-filters\s*\{[^}]*grid-template-columns: minmax\(6\.5rem, \.65fr\) minmax\(8rem, \.8fr\) minmax\(12rem, 1\.5fr\) auto;/);
});
