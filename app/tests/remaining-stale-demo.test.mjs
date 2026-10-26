import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url),stale=require(path.join(root,'lib/stale-edit.ts'));
const initial='2026-10-01T00:00:00.000Z';
let actor={id:7,role:'ADMIN'},enabled=true,request={id:3,requestedById:7,operationalOwnerId:7,notes:'Original notes',updatedAt:new Date(initial)};
const prisma={demoRequest:{findFirst:async()=>({...request}),update:async({where,data})=>{if(where.updatedAt.getTime()!==request.updatedAt.getTime())throw Object.assign(new Error('stale'),{code:'P2025'});request={...request,...data};return {...request};}}};
const mocks={
  'next/cache':{revalidatePath:()=>{}},
  '@/lib/module-availability':{assertModuleEnabled:async()=>{if(!enabled)throw new Error('Module unavailable')}},
  '@/lib/current-user':{requireMutation:async()=>{if(actor.role==='READ_ONLY')throw new Error('Access denied');return actor}},
  '@/lib/prisma':{prisma},
  '@/lib/demos':{demoReadWhere:()=>({}),canEditDemo:a=>a.role==='ADMIN'},
  '@/lib/authorization':{can:()=>false},
  '@/lib/projects':{canEditProject:()=>false,projectReadWhere:()=>({})},
  '@/lib/demo-operations':{dateOnly:()=>''},
  '@/lib/assignment-eligibility':{eligibleUserWhere:()=>({})},
  '@/lib/unavailable-work':{activeDemoWhere:{}},
  '@/lib/stale-edit':stale,
};
const originalLoad=Module._load;
Module._load=function(specifier,parent,isMain){return specifier in mocks?mocks[specifier]:originalLoad.call(this,specifier,parent,isMain)};
let actions;
try{actions=require(path.join(root,'app/demos/actions.ts'))}finally{Module._load=originalLoad}
const form=(notes,editToken)=>{const result=new FormData();result.set('notes',notes);if(editToken)result.set('editToken',editToken);return result};

test('Demo notes accept current version and reject missing, invalid, stale and unauthorized edits',async()=>{
  await actions.updateDemoNotes(3,form('Latest notes',initial));
  const latest=request.updatedAt.toISOString();assert.notEqual(latest,initial);
  for(const token of [undefined,'invalid',initial]){
    const result=await actions.updateDemoNotes(3,form('Stale notes',token));
    assert.equal(result.error,stale.recordChangedMessage);
  }
  assert.equal(request.notes,'Latest notes');
  actor={id:8,role:'READ_ONLY'};
  await assert.rejects(actions.updateDemoNotes(3,form('Denied',latest)),/Access denied/);
  actor={id:7,role:'ADMIN'};
  enabled=false;
  await assert.rejects(actions.updateDemoNotes(3,form('Disabled',latest)),/Module unavailable/);
  enabled=true;
  assert.equal(request.notes,'Latest notes');
  const raceToken=request.updatedAt.toISOString();
  const outcomes=await Promise.all([actions.updateDemoNotes(3,form('First note',raceToken)),actions.updateDemoNotes(3,form('Second note',raceToken))]);
  assert.equal(outcomes.filter(result=>result===undefined).length,1);
  assert.equal(outcomes.filter(result=>result?.error===stale.recordChangedMessage).length,1);
  assert.ok(['First note','Second note'].includes(request.notes));
});
