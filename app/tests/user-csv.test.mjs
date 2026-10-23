import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {previewUserCsv,reviewUserCsv,applyUserCsv,exportUserCsv,signUserCsvPreview,parseUserCsv,spreadsheetCsv} = require('../lib/user-csv.ts');
process.env.AUTH_SECRET = 'user-csv-test-only';
const user = (id,role='SALES',extra={})=>({id,role,firstName:'민준',lastName:'김',email:`u${id}@example.test`,active:true,archivedAt:null,timeZone:'UTC',delegatedUserAdministrationEnabled:false,createdAt:new Date('2026-01-01'),updatedAt:new Date('2026-01-01'),...extra});
const admin=user(1,'ADMIN');
const header='First Name,Last Name,Email,Role,Active,Timezone\n';
const line=(email='new@example.test',role='SALES',active='true',zone='Asia/Seoul',first='민준')=>`${first},김,${email},${role},${active},${zone}\n`;
function database(initial=[admin],failAt=0) {
 let users=structuredClone(initial),history=[], writes=0;
 const tx={ $queryRaw:async()=>[], user:{
 findMany:async({where,include}={})=>users.filter(u=> !where || !('archivedAt' in where) || (where.archivedAt===null ? !u.archivedAt : !!u.archivedAt)).map(u=>include?({...u,identities:[{id:8}]}):u),
 findUnique:async({where})=>users.find(u=>u.id===where.id),
 count:async({where})=>users.filter(u=>u.id!==where.id.not&&u.role==='ADMIN'&&u.active&&!u.archivedAt).length,
 create:async({data})=>{if(++writes===failAt)throw new Error('injected failure');const u=user(users.length+1,data.role,data);users.push(u);return u;},
 update:async({where,data})=>{if(++writes===failAt)throw new Error('injected failure');const i=users.findIndex(u=>u.id===where.id);users[i]={...users[i],...data,updatedAt:new Date()};return users[i];},
 }, adminMaintenanceEvent:{create:async({data})=>history.push(data)}};
 for(const name of ['account','opportunity','project','task','supportCase','tradeShowLead','tradeShow','priceException','demoRequest','salesPlan','salesTarget'])tx[name]={count:async()=>2};
 return {tx,get users(){return users;},get history(){return history;},$transaction:async fn=>{const before=structuredClone(users),events=structuredClone(history);try{return await fn(tx);}catch(e){users=before;history=events;throw e;}}};
}
async function apply(db,csv){const preview=await reviewUserCsv(db,admin,csv);return applyUserCsv(db,admin,csv,signUserCsvPreview(1,preview.digest));}
for(const role of ['SALES','SALES_MANAGER','SUPPORT','SUPPORT_MANAGER','MARKETING_MANAGER','EXECUTIVE','READ_ONLY'])test(`direct import/export rejects ${role}`,async()=>{
 const actor=user(2,role),trap=new Proxy({},{get(){throw new Error('unexpected access');}});
 for(const fn of [()=>reviewUserCsv(trap,actor,header+line()),()=>applyUserCsv(trap,actor,header+line(),''),()=>exportUserCsv(trap,actor,'all')])await assert.rejects(fn,/Access denied/);
});
for(const extra of [{active:false},{archivedAt:new Date()}])test(`inactive/archived actor denied ${JSON.stringify(extra)}`,async()=>{
 const db=database([user(1,'ADMIN',extra)]);
 await assert.rejects(reviewUserCsv(db,admin,header+line()),/Access denied/);
 await assert.rejects(applyUserCsv(db,admin,header+line(),''),/Access denied/);
 await assert.rejects(exportUserCsv(db,admin,'all'),/Access denied/);
});
test('delegated manager may export but cannot import ordinary, Admin, or delegation grants',async()=>{
 const actor=user(2,'SALES_MANAGER',{delegatedUserAdministrationEnabled:true}),db=database([admin,actor]);
 for(const csv of [header+line(),header+line('new@example.test','ADMIN'),header.trim()+',User Administration Access\n'+line().trim()+',yes'])await assert.rejects(applyUserCsv(db,actor,csv,''),/Access denied/);
 assert.match(await exportUserCsv(db,actor,'active'),/Linked/);
});
test('parser rejects malformed CSV, unsupported/delegation fields and limits',()=>{
 for(const csv of ['Email\na@example.test',header+'"unclosed',header.replace('Email','Email,Email')+line(),header.replace('Email','User Administration Access')+line()])assert.ok(parseUserCsv(csv).errors.length);
 assert.throws(()=>parseUserCsv('x'.repeat(500001)),/500 KB/);
 assert.throws(()=>parseUserCsv(header+line().repeat(501)),/500 users/);
});
test('malformed fields, duplicates, archived matches and conflicting existing emails classify Error',async()=>{
 for(const csv of [header+line('new@example.test','FUTURE'),header+line('new@example.test','SALES','1'),header+line('new@example.test','SALES','yes','Mars/City'),header+line()+line(' NEW@example.test '),header+line('new@example.test','SALES','',''),header+line('new@example.test','SALES','true','UTC','x'.repeat(321))]){
 const p=await previewUserCsv(database().tx,admin,csv); assert.ok(p.rows.some(r=>r.action==='Error'),csv);
 }
 for(const users of [[admin,user(2,'SALES',{archivedAt:new Date()})],[admin,user(2),user(3,'SALES',{email:' U2@example.test '})]]){
 const p=await previewUserCsv(database(users).tx,admin,header+line('u2@example.test'));assert.equal(p.rows[0].action,'Error');
 }
});
test('creates supported roles with Unicode and shared history, no identity writes',async()=>{
 const db=database(); const csv=header+['SALES','SUPPORT','EXECUTIVE','SUPPORT_MANAGER'].map((r,i)=>line(`new${i}@example.test`,r)).join('');
 const result=await apply(db,csv);assert.equal(result.rows.filter(r=>r.action==='Create').length,4);assert.equal(db.users[1].firstName,'민준');assert.equal(db.history.filter(e=>e.action==='User created').length,4);
 assert.ok(db.users.slice(1).every(u=>u.timeZone==='Asia/Seoul'));
});
test('updates names, timezone, role and status; preserves email and identities; unchanged rows',async()=>{
 const db=database([admin,user(2,'SALES',{email:' U2@EXAMPLE.TEST ',identityLink:'stable'})]);
 await apply(db,header+line('u2@example.test','EXECUTIVE','no','Asia/Seoul','현우'));
 assert.equal(db.users[1].identityLink,'stable'); assert.equal(db.users[1].email,' U2@EXAMPLE.TEST ');assert.equal(db.users[1].active,false);
 for(const action of ['Name changed','Timezone changed','Role changed','Status changed'])assert.ok(db.history.some(h=>h.action===action),action);
 assert.equal(db.history.some(h=>h.action==='Email changed'),false);
 await apply(db,header+line('u2@example.test','EXECUTIVE','yes','Asia/Seoul','현우'));assert.equal(db.users[1].active,true);
 const p=await apply(db,header+line('u2@example.test','EXECUTIVE','','','현우'));assert.equal(p.rows[0].action,'Unchanged');
});
test('normalized email matches without changing an existing address',async()=>{
 const db=database([admin,user(2,'SALES',{email:' U2@EXAMPLE.TEST '})]);
 const result=await apply(db,header+line('u2@example.test','SALES','true','UTC'));
 assert.equal(result.rows[0].action,'Unchanged');
 assert.equal(db.users[1].email,' U2@EXAMPLE.TEST ');
 assert.equal(db.history.length,0);
});
test('impact preview reuses active work service and stale work fails without writes',async()=>{
 const db=database([admin,user(2)]),csv=header+line('u2@example.test','EXECUTIVE');
 const p=await reviewUserCsv(db,admin,csv);assert.ok(p.rows[0].impact.some(i=>i.area==='Open Opportunities'&&i.count===2));
 db.tx.opportunity.count=async()=>3;
 await assert.rejects(applyUserCsv(db,admin,csv,signUserCsvPreview(1,p.digest)),/preview/);assert.equal(db.history.length,0);
});
test('single and batch final-Admin removal rejected; replacement Admin safely applied first',async()=>{
 for(const users of [[admin],[admin,user(2,'ADMIN')]]){
 const db=database(users),csv=header+users.map(u=>line(u.email,'SALES')).join('');
 const p=await reviewUserCsv(db,admin,csv);assert.match(p.errors.join(),/at least one active/);await assert.rejects(applyUserCsv(db,admin,csv,signUserCsvPreview(1,p.digest)),/Correct/);
 }
 const db=database();await apply(db,header+line(admin.email,'SALES')+line('replacement@example.test','ADMIN'));assert.ok(db.users.some(u=>u.role==='ADMIN'&&u.active));
});
test('clean batch and history roll back on persistence failure; tampering and replay fail',async()=>{
 const db=database([admin],2);await assert.rejects(apply(db,header+line()+line('second@example.test')),/injected/);assert.equal(db.users.length,1);assert.equal(db.history.length,0);
 const healthy=database(),csv=header+line(),p=await reviewUserCsv(healthy,admin,csv),token=signUserCsvPreview(1,p.digest);
 await assert.rejects(applyUserCsv(healthy,admin,csv,token+'x'),/preview/);
 await assert.rejects(applyUserCsv(healthy,admin,header+line('evil@example.test'),token),/preview/);
 await applyUserCsv(healthy,admin,csv,token);await assert.rejects(applyUserCsv(healthy,admin,csv,token),/preview/);
});
test('export honors visibility and excludes secrets; spreadsheet formula escaping',async()=>{
 const db=database([admin,user(2,'SALES',{firstName:'=CMD()',archivedAt:new Date(),subject:'secret-subject'})]);
 const active=await exportUserCsv(db,admin,'active'),all=await exportUserCsv(db,admin,'all');
 assert.doesNotMatch(active,/CMD/);assert.match(all,/'=CMD/);assert.doesNotMatch(all,/secret-subject|issuer|subject|token/i);
 for(const value of ['=1','+1','-1','@x',' \t=cmd','\tfoo','\rfoo','\nfoo'])assert.ok(spreadsheetCsv([[value]]).startsWith('\uFEFF"\''));
 assert.match(spreadsheetCsv([['김','a"b','a,b']]),/a""b/);
});

test('browser CRLF normalization preserves signed review',async()=>{const db=database(),csv=header+line(),p=await reviewUserCsv(db,admin,csv);await applyUserCsv(db,admin,csv.replaceAll('\n','\r\n'),signUserCsvPreview(1,p.digest));assert.equal(db.users.length,2);});
