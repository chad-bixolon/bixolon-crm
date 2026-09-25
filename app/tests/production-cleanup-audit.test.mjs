import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyze, emptySnapshot, readSnapshot, writeReport } from '../scripts/operations/audit-production-cleanup.mjs';

const before=new Date('2026-09-20T12:00:00Z');
const after=new Date('2026-09-26T12:00:00Z');
const user={id:1,firstName:'Admin',lastName:'User',role:'ADMIN',createdAt:before};

test('empty categories produce counts and readable private CSV files',async()=>{
  const result=analyze(emptySnapshot());
  assert.equal(result.candidates.length,0);
  assert.equal(result.duplicates.length,0);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'saleshub-cleanup-test-'));
  try {
    const files=await writeReport(result,directory,{host:'local-db',database:'fixture'});
    assert.ok(files.includes('document-inventory.csv'));
    assert.match(await fs.readFile(path.join(directory,'accounts-candidates.csv'),'utf8'),/confidence/);
    assert.equal((await fs.stat(path.join(directory,'production-cleanup-summary.md'))).mode & 0o777,0o600);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test('database snapshot uses read methods only',async()=>{
  const calls=[];
  const db=new Proxy({}, {get(_target,model){return {findMany:async options=>{calls.push({model,options});return [];}};}});
  const result=await readSnapshot(db);
  assert.deepEqual(Object.keys(result).sort(),Object.keys(emptySnapshot()).sort());
  assert.equal(calls.length,Object.keys(result).length);
  assert.ok(calls.every(call=>call.options.select&&Object.values(call.options.select).every(value=>value===true)));
});

test('confidence uses multiple signals and real relationships raise cleanup risk',()=>{
  const data=emptySnapshot();
  data.users=[user];
  data.accounts=[
    {id:1,name:'Test Account',phone:'555-0100',createdAt:before,updatedAt:before,createdById:1,status:'ACTIVE'},
    {id:2,name:'Real Customer',createdAt:after,updatedAt:after,createdById:1,status:'ACTIVE'},
    {id:7,name:'Test Account Solo',createdAt:before,updatedAt:before,createdById:1,status:'ACTIVE'},
  ];
  data.contacts=[{id:6,firstName:'Pat',lastName:'Lee',accountId:1,createdAt:after,updatedAt:after}];
  data.projects=[{id:3,name:'Pilot installation',createdAt:before,updatedAt:before,createdById:1,status:'PLANNING',primaryAccountId:2}];
  data.opportunities=[{id:4,name:'Demo opportunity',createdAt:before,updatedAt:before,createdById:1,legacyAccountId:2,currencyCode:'USD',forecastCategory:'PIPELINE'}];
  data.opportunityProducts=[{id:5,opportunityId:4,productId:9,quantity:2,estimatedUnitPrice:10}];
  data.products=[{id:9,name:'Legitimate printer',sku:'P-9',createdAt:before,updatedAt:before,active:true}];
  const result=analyze(data);
  assert.equal(result.buckets.accounts[0].confidence,'HIGH');
  assert.equal(result.buckets.accounts[0].cleanupRisk,'MEDIUM');
  assert.equal(result.buckets.accounts.find(row=>row.id===7).suggestedReview,'Archive candidate');
  assert.equal(result.buckets.contacts[0].cleanupRisk,'MEDIUM');
  assert.match(result.buckets.contacts[0].reasons,/linked to high-confidence test Account/);
  assert.equal(result.buckets.projects[0].cleanupRisk,'HIGH');
  assert.equal(result.buckets.opportunities[0].cleanupRisk,'HIGH');
  assert.match(result.buckets.opportunities[0].linkedAccounts,/Real Customer/);
  assert.equal(result.buckets.products.length,0);
});

test('duplicate grouping is deterministic; catalog sample text alone is not suspicious',()=>{
  const data=emptySnapshot();
  data.accounts=[{id:1,name:'Alpha',website:'https://www.alpha.example.net',createdAt:after},{id:2,name:'Beta',website:'https://alpha.example.net',createdAt:after}];
  data.contacts=[{id:3,firstName:'A',lastName:'B',email:'Person@Business.com',createdAt:after},{id:4,firstName:'C',lastName:'D',email:'person@business.com',createdAt:after}];
  data.products=[{id:7,name:'Printer',sku:'PR-7',createdAt:before,active:true}];
  data.skus=[{id:8,productId:7,partNumber:'PR-7',description:'Includes sample thermal roll',createdAt:before,active:true}];
  const result=analyze(data);
  assert.equal(result.duplicates.filter(x=>x.entity==='Account'&&x.matchRule==='same website domain').length,1);
  assert.equal(result.duplicates.filter(x=>x.entity==='Contact'&&x.matchRule==='normalized email').length,1);
  assert.equal(result.buckets.skus.length,0);
});

test('document report contains parent and uploader but only the storage-key prefix',async()=>{
  const data=emptySnapshot();
  data.users=[user];
  data.accounts=[{id:2,name:'Real Customer',createdAt:after,status:'ACTIVE'}];
  data.documents=[{id:9,originalFileName:'test-proposal.pdf',storageKey:'prod/documents/private-uuid',fileSize:100,documentType:'PROPOSAL',uploadedByUserId:1,createdAt:after,accountId:2}];
  const result=analyze(data);
  assert.equal(result.buckets.documents[0].cleanupRisk,'HIGH');
  assert.equal(result.documentInventory[0].storageKeyPrefix,'prod/documents');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'saleshub-cleanup-test-'));
  try {
    await writeReport(result,directory,{host:'local-db',database:'fixture'});
    const inventory=await fs.readFile(path.join(directory,'document-inventory.csv'),'utf8');
    assert.match(inventory,/Real Customer/);
    assert.match(inventory,/prod\/documents/);
    assert.doesNotMatch(inventory,/private-uuid|postgresql:\/\//);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
