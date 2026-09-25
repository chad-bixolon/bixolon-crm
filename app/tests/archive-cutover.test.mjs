import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const operational=require(path.join(root,'lib/operational-where.ts'));
const {accountWhere}=require(path.join(root,'lib/accounts.ts'));
const {contactWhere}=require(path.join(root,'lib/contacts.ts'));
const {productWhere}=require(path.join(root,'lib/products.ts'));
const {priceExceptionWhere}=require(path.join(root,'lib/price-exceptions.ts'));
const {taskWhere,dashboardOpenTaskWhere}=require(path.join(root,'lib/work.ts'));
const {opportunityWhere,opportunityOptions}=require(path.join(root,'lib/opportunities.ts'));
const {audienceContactWhere}=require(path.join(root,'lib/marketing-audiences.ts'));

test('archived Account and Project parents disqualify active Opportunities from operational queries',()=>{
  const o=operational.operationalOpportunityWhere;
  assert.equal(o.archivedAt,null);
  assert.deepEqual(o.AND[0].OR[1].legacyAccount.is,operational.operationalAccountWhere);
  assert.deepEqual(o.AND[1].participants.none.account.OR[0],{archivedAt:{not:null}});
  assert.deepEqual(o.AND[2].projects.none.project.NOT,operational.operationalProjectWhere);
  assert.deepEqual(operational.operationalProjectWhere.AND[0].OR[1].primaryAccount.is,operational.operationalAccountWhere);
  assert.ok(opportunityWhere({}).AND.includes(o));
  assert.equal(opportunityWhere({archived:'all'}).AND,undefined);
});

test('Tasks and Activities with archived operational parents are excluded from live metrics',()=>{
  for(const predicate of [operational.operationalTaskWhere,operational.operationalActivityWhere]){
    assert.equal(predicate.archivedAt,null);
    assert.deepEqual(predicate.AND[0].OR[1].account.is,operational.operationalAccountWhere);
    assert.deepEqual(predicate.AND[1].OR[1].project.is,operational.operationalProjectWhere);
    assert.deepEqual(predicate.AND[2].OR[1].opportunity.is,operational.operationalOpportunityWhere);
  }
  assert.deepEqual(dashboardOpenTaskWhere().AND,[operational.operationalTaskWhere]);
  assert.deepEqual(taskWhere({}).AND,[operational.operationalTaskWhere]);
  assert.equal(taskWhere({visibility:'all'}).AND,undefined);
});

test('default lists hide archived records while explicit historical views retain them',()=>{
  assert.equal(accountWhere({}).archivedAt,null);
  assert.equal(accountWhere({status:'ARCHIVED'}).archivedAt,undefined);
  assert.equal(contactWhere({}).archivedAt,null);
  assert.deepEqual(contactWhere({active:'archived'}).archivedAt,{not:null});
  assert.equal(contactWhere({active:'all'}).archivedAt,undefined);
  assert.equal(productWhere({}).archivedAt,null);
  assert.equal(productWhere({active:'all'}).archivedAt,undefined);
  assert.deepEqual(priceExceptionWhere({}).AND[0],{archivedAt:null});
  assert.deepEqual(priceExceptionWhere({status:'ARCHIVED'}).AND[0],{OR:[{archivedAt:{not:null}},{status:'ARCHIVED'}]});
});

test('operational pickers and audience membership reject archived parent relationships',async()=>{
  const calls={};const find=key=>async args=>{calls[key]=args.where;return []};
  await opportunityOptions({account:{findMany:find('account')},contact:{findMany:find('contact')},user:{findMany:find('user')},salesStage:{findMany:find('stage')},currency:{findMany:find('currency')},product:{count:async()=>0},project:{findMany:find('project')},productCategory:{findMany:find('category')},competitorOption:{findMany:find('competitor')}});
  assert.deepEqual(calls.account,operational.operationalAccountWhere);
  assert.deepEqual(calls.contact,operational.operationalContactWhere);
  assert.deepEqual(calls.project,operational.operationalProjectWhere);
  assert.deepEqual(audienceContactWhere({}).AND[0],operational.operationalContactWhere);
});
