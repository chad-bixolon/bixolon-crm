import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const stale=require(path.join(root,'lib/stale-edit.ts'));
const initial='2026-10-01T00:00:00.000Z';
let actor={id:7,role:'ADMIN'},enabled=true,relationshipWrites=0;
let audience={id:3,name:'Original audience',description:null,visibility:'SHARED',filterConfig:{},ownerId:7,archivedAt:null,updatedAt:new Date(initial)};
const update=async({where,data})=>{
  if(where.updatedAt && where.updatedAt.getTime()!==audience.updatedAt.getTime())throw Object.assign(new Error('stale'),{code:'P2025'});
  audience={...audience,...data};return {...audience};
};
const tx={marketingAudience:{update},contact:{count:async()=>1},marketingAudienceContactOverride:{deleteMany:async()=>{relationshipWrites++}}};
const prisma={marketingAudience:{findUnique:async()=>({...audience}),update},$transaction:async fn=>fn(tx)};
const mocks={
  'next/cache':{revalidatePath:()=>{}},
  'next/navigation':{redirect:pathname=>{throw new Error(`REDIRECT:${pathname}`)}},
  '@/lib/prisma':{prisma},
  '@/lib/current-user':{currentUser:async()=>actor},
  '@/lib/module-availability':{assertModuleEnabled:async()=>{if(!enabled)throw new Error('Module unavailable')},getModuleAvailability:async()=>({effective:new Set(['TRADE_SHOWS'])})},
  '@/lib/operational-where':{operationalContactWhere:{}},
  '@/lib/marketing-audiences':{audienceVisibilities:['PERSONAL','SHARED'],canManageAudience:a=>a.role==='ADMIN',canViewAudience:()=>true,audienceRequiresTradeShows:()=>false,validateAudienceConfig:value=>value,parseAudienceForm:()=>({}),audienceContactWhere:()=>({})},
  '@/lib/save-feedback':{saveFeedbackPath:(href)=>href},
  '@/lib/stale-edit':stale,
};
const originalLoad=Module._load;
Module._load=function(specifier,parent,isMain){return specifier in mocks?mocks[specifier]:originalLoad.call(this,specifier,parent,isMain)};
let actions;
try{actions=require(path.join(root,'app/marketing/audiences/actions.ts'))}finally{Module._load=originalLoad}
const form=(entries)=>{const result=new FormData();for(const [key,value] of entries)result.set(key,String(value));return result};
const edit=token=>form([['audienceId',3],['editToken',token],['name','New audience'],['visibility','SHARED']]);

test('Audience definition edits require a current token after authorization',async()=>{
  await assert.rejects(actions.saveAudience({},edit(initial)),/REDIRECT:.*marketing\/audiences\/3/);
  assert.equal(audience.name,'New audience');
  const latest=audience.updatedAt.toISOString();
  assert.notEqual(latest,initial);
  assert.equal((await actions.saveAudience({},edit(initial))).recordChanged,true);
  assert.equal((await actions.saveAudience({},form([['audienceId',3],['name','Missing token'],['visibility','SHARED']]))).recordChanged,true);
  assert.equal((await actions.saveAudience({},edit('invalid'))).recordChanged,true);
  assert.equal(audience.name,'New audience');
  actor={id:8,role:'READ_ONLY'};
  await assert.rejects(actions.saveAudience({},edit(latest)),/Access denied/);
  actor={id:7,role:'ADMIN'};
  enabled=false;
  await assert.rejects(actions.saveAudience({},edit(latest)),/Module unavailable/);
  enabled=true;
});

test('Audience selection claims the parent before relationship changes under concurrent saves',async()=>{
  const opened=audience.updatedAt.toISOString(),selection=form([['audienceId',3],['contactId',9],['selected','true'],['editToken',opened]]);
  const results=await Promise.all([actions.setContactSelection(selection),actions.setContactSelection(selection)]);
  assert.deepEqual(results.map(result=>Object.keys(result)[0]).sort(),['error','success']);
  assert.equal(relationshipWrites,1);
  assert.equal((await actions.setContactSelection(selection)).error,stale.recordChangedMessage);
  assert.equal(relationshipWrites,1);
});
