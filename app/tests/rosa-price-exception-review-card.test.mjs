import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.tsx']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const originalResolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {RosaReviewCard}=require(path.join(root,'app/administration/imports/price-exceptions/rosa/review-card.tsx'));
const {ImportSearchPicker}=require(path.join(root,'components/import-search-picker.tsx'));

const resolved=(source,id,name)=>({source,id,name,issue:null});
const unresolved=source=>({source,id:null,name:null,issue:'No CRM match.'});
function render(manual){
  const group={groupKey:'PE-1',peNumber:'PE-1',sourceLines:[2,3],statusSource:'Approved',statusMapped:'ACTIVE',requestedAt:'2026-09-25T00:00:00Z',reviewedAt:'2026-09-25T01:00:00Z',requestedBy:resolved('Amber Smith',1,'Amber Smith'),reviewedBy:resolved('Gary Lee',3,'Gary Lee'),customer:resolved('Bluestar',10,'Bluestar'),varAccount:manual?.accountIds?.VAR?resolved('Sonda in Chile',11,'Sonda Chile'):unresolved('Sonda in Chile'),endUser:resolved('Falabella Stores',12,'Falabella Stores'),expirationDate:'2027-06-30',currency:'USD',description:'Offer',tiers:[{line:2,sku:manual?.skuIds?.[2]?resolved('ABC123',21,'CRM-ABC'):unresolved('ABC123'),quantity:'100',currency:'USD',originalPrice:'10.00',approvedPrice:'9.00'}],disposition:'REVIEW REQUIRED',messages:['VAR: No CRM match.','Line 2 SKU: No CRM match.'],conflictOptions:[{field:'Description',values:[{line:2,value:'Offer'},{line:3,value:'Offer revised'}]}],changedFields:[]};
  const plan={groups:[group],choices:{accounts:[{id:11,name:'Sonda Chile'}],users:[],skus:[{id:21,name:'CRM-ABC'}]}};
  return renderToStaticMarkup(React.createElement(RosaReviewCard,{group,plan,manual,disabled:false,onResolve(){},onCreateAccount(){}}));
}

test('review card shows source values beside searchable CRM resolution controls and source conflict choices',()=>{
  const html=render();
  assert.match(html,/Source: Sonda in Chile/);
  assert.match(html,/Search CRM VAR/);
  assert.match(html,/\+ Create Account/);
  assert.match(html,/w-full min-w-0/);
  assert.match(html,/Source: ABC123/);
  assert.match(html,/Search CRM SKU on source line 2/);
  assert.match(html,/Line 2: Offer/);
  assert.match(html,/Line 3: Offer revised/);
  assert.match(html,/Resolve conflicting Description/);
});

test('review card keeps source visible and shows reviewed CRM selections with Change controls',()=>{
  const html=render({accountIds:{VAR:11},skuIds:{2:21}});
  assert.match(html,/Source: Sonda in Chile/);
  assert.match(html,/Resolved to: <strong>Sonda Chile<\/strong>/);
  assert.match(html,/Source: ABC123/);
  assert.match(html,/Resolved to: <strong>CRM-ABC<\/strong>/);
  assert.match(html,/Change/);
});
test('shared picker displays complete selected Account names at review panel width',()=>{
  const name='A Very Long Distributor and Customer Account Name Across Several Regions';
  const html=renderToStaticMarkup(React.createElement(ImportSearchPicker,{label:'CRM VAR',items:[{id:99,name}],value:99,onChange(){}}));
  assert.match(html,/w-full min-w-0/);
  assert.match(html,/Selected: A Very Long Distributor and Customer Account Name Across Several Regions/);
  assert.match(html,/aria-label="Search CRM VAR"/);
  assert.match(html,/aria-label="CRM VAR"/);
});
