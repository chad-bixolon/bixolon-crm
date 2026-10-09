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
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
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
  assert.match(html,/<label[^>]*>CRM VAR<\/label><input[^>]*role="combobox"/);
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
test('newer changed submission shows only changed fields and explicit promotion actions, even with the same filename',()=>{
  const group={groupKey:'PE-1',peNumber:'PE-1',sourceLines:[2],statusSource:'Approved',statusMapped:'ACTIVE',requestedAt:'2026-09-04T00:00:00Z',reviewedAt:'2026-09-04T01:00:00Z',requestedBy:resolved('Amber Smith',1,'Amber Smith'),reviewedBy:resolved('Gary Lee',3,'Gary Lee'),customer:resolved('Bluestar',10,'Bluestar'),varAccount:resolved('Sonda in Chile',11,'Sonda in Chile'),endUser:resolved('New End User',12,'New End User'),expirationDate:'2027-06-30',currency:'USD',description:'Offer',tiers:[{line:2,sku:resolved('ABC123',21,'ABC123'),quantity:'1001',currency:'USD',originalPrice:'10.00',approvedPrice:'9.00'}],disposition:'REVIEW REQUIRED',messages:[],conflictOptions:[],conflictingFields:[],changedFields:['Requested At','End User','Pricing tiers'],revisionDifferences:[{field:'Requested At',current:'2026-09-03T00:00:00Z',proposed:'2026-09-04T00:00:00Z'},{field:'End User',current:'Original End User',proposed:'New End User'},{field:'Quantity',current:'1000',proposed:'1001'}],currentRevision:{id:1,fileName:'same.csv',header:{'Requested At':'2026-09-03T00:00:00Z','End User':'Original End User'},tiers:[JSON.stringify(['ABC123','1000','10.00','9.00','USD'])]},revisionAction:'PROMOTE'};
  const html=renderToStaticMarkup(React.createElement(RosaReviewCard,{group,plan:{fileName:'same.csv',choices:{accounts:[],users:[],skus:[]}},disabled:false,onResolve(){},onPromote(){},onKeep(){}}));
  assert.match(html,/Newer submission available/);
  assert.match(html,/Original End User/);
  assert.match(html,/New End User/);
  assert.match(html,/>Quantity<\/th>/);
  assert.doesNotMatch(html,/Current imported revision|New source revision|>Currency<\/th>/);
  assert.match(html,/Keep Current Version/);
  assert.match(html,/Use New Submission/);
  assert.match(html,/Using the new submission makes it the current Price Exception while preserving the existing version in revision history/);
  assert.match(html,/Requested Sep 3, 2026 at 8:00 PM/);
  assert.match(html,/Reviewed Sep 3, 2026 at 9:00 PM/);
  assert.match(html,/>Sep 2, 2026 at 8:00 PM<\/td>/);
  assert.match(html,/>Sep 3, 2026 at 8:00 PM<\/td>/);
  assert.doesNotMatch(html,/2026-09-0[34]T/);
});

test('absent roles render as empty values without Account resolution controls',()=>{
  const group={groupKey:'PE-1',peNumber:'PE-1',sourceLines:[2],statusSource:'Approved',statusMapped:'ACTIVE',requestedAt:'2026-09-04T15:38:40.940457+00:00',reviewedAt:'2026-09-04T18:41:00+00:00',requestedBy:resolved('Amber Smith',1,'Amber Smith'),reviewedBy:resolved('Gary Lee',3,'Gary Lee'),customer:resolved('Bluestar',10,'Bluestar'),varAccount:{source:'N/A',id:null,name:null,issue:null},endUser:{source:'na',id:null,name:null,issue:null},expirationDate:'2027-06-30',currency:'USD',description:'Offer',tiers:[],disposition:'READY',messages:[],conflictOptions:[],conflictingFields:[],changedFields:[],currentRevision:null,revisionAction:'NONE'};
  const html=renderToStaticMarkup(React.createElement(RosaReviewCard,{group,plan:{choices:{accounts:[],users:[],skus:[]}},disabled:false,onResolve(){},onCreateAccount(){}}));
  assert.match(html,/VAR: — · End User: —/);
  assert.match(html,/Requested Sep 4, 2026 at 11:38 AM/);
  assert.match(html,/Reviewed Sep 4, 2026 at 2:41 PM/);
  assert.doesNotMatch(html,/2026-09-04T|Search CRM VAR|Search CRM End User|Create Account|No CRM match/);
});

test('older submission explains no pricing change and hides the comparison table',()=>{
  const group={groupKey:'PE-1',peNumber:'PE-1',sourceLines:[],statusSource:'Approved',statusMapped:'ACTIVE',requestedAt:'old',reviewedAt:'old',requestedBy:resolved('A',1,'A'),reviewedBy:resolved('B',2,'B'),customer:resolved('C',3,'C'),varAccount:resolved('V',4,'V'),endUser:resolved('E',5,'E'),expirationDate:'2027-06-30',currency:'USD',description:'Offer',tiers:[],disposition:'REVIEW REQUIRED',messages:[],conflictOptions:[],conflictingFields:[],changedFields:['Pricing tiers'],revisionDifferences:[],currentRevision:{id:1,fileName:'same.csv',header:{},tiers:[]},revisionAction:'OLDER'};
  const html=renderToStaticMarkup(React.createElement(RosaReviewCard,{group,plan:{fileName:'same.csv',choices:{accounts:[],users:[],skus:[]}},disabled:false,onResolve(){}}));
  assert.match(html,/Older submission detected/);
  assert.match(html,/This Price Exception already has a newer reviewed submission\. No pricing changes will be made\./);
  assert.doesNotMatch(html,/Changed field|Keep Current|Promote New Revision|Current imported revision/);
});
