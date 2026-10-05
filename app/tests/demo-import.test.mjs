import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {demoHeaders,parseDemoCsv,planDemoImport,applyDemoImport,mapDemoSourceAccount,mapDemoSourceSku}=require(path.join(root,'lib/demo-import.ts'));
const {can,permissionForPath,routeAccess}=require(path.join(root,'lib/authorization.ts'));
const {assertDemoContext,demoLabel,demoReadWhere}=require(path.join(root,'lib/demos.ts'));
const {demoPreviewDate,demoPreviewFieldLabel,demoPreviewIssue,demoPreviewItemSummary,demoPreviewShipping}=require(path.join(root,'lib/demo-preview-display.ts'));
const fixture=fs.readFileSync(path.join(root,'../reference-data/demo-requests-2026-09-28.csv'),'utf8');
const parsed=parseDemoCsv(fixture);
const row=(source,changes={},line=source.line)=>({line,values:{...source.values,...changes}});
const input=(...rows)=>({rows,errors:[]});
const names=[...new Set(parsed.rows.map(item=>item.values.VAR))];
const sourceSkus=[...new Set(parsed.rows.map(item=>item.values['SKU / Model']))];
const sourceUsers=[...new Set(parsed.rows.flatMap(item=>[item.values['Requested By'],item.values['Reviewed By'],item.values['Shipped By']]).filter(Boolean))];
function db({accounts=names,skus=sourceSkus,users=sourceUsers}={}){
  const state={requests:[],items:[],units:[],revisions:[]};let nextRequest=1,nextItem=1,nextUnit=1,nextRevision=1,failItem=false;
  const client={state,setFailItem(value){failItem=value;},
    account:{findMany:async()=>accounts.map((name,index)=>({id:index+1,name}))},
    user:{findMany:async()=>users.map((name,index)=>({id:index+1,firstName:name,lastName:'CRM'}))},
    productSku:{findMany:async()=>skus.map((partNumber,index)=>({id:index+1,partNumber}))},
    demoRequest:{findMany:async()=>state.requests.map(request=>({...request,items:state.items.filter(item=>item.demoRequestId===request.id),revisions:state.revisions.filter(revision=>revision.demoRequestId===request.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,1)})),create:async({data})=>{const request={...data,id:nextRequest++};state.requests.push(request);return request;},update:async({where,data})=>{const request=state.requests.find(item=>item.id===where.id);Object.assign(request,data);return request;}},
    demoSourceRevision:{create:async({data})=>{if(state.revisions.some(item=>item.demoRequestId===data.demoRequestId&&item.contentHash===data.contentHash))throw Error('Duplicate revision');const revision={...data,id:nextRevision++,createdAt:new Date(Date.now()+nextRevision)};state.revisions.push(revision);return revision;}},
    demoItem:{upsert:async({where,create,update})=>{if(failItem)throw Error('Item write failed');const item=state.items.find(item=>item.demoRequestId===where.demoRequestId_sourceLineKey.demoRequestId&&item.sourceLineKey===where.demoRequestId_sourceLineKey.sourceLineKey);if(item)Object.assign(item,update);else {const created={...create,id:nextItem++,retiredAt:null};state.items.push(created);return created;}return item;},findMany:async({where})=>state.items.filter(item=>item.demoRequestId===where.demoRequestId&&!item.retiredAt),update:async({where,data})=>Object.assign(state.items.find(item=>item.id===where.id),data)},
    demoUnit:{findMany:async({where})=>state.units.filter(unit=>unit.demoItemId===where.demoItemId).sort((a,b)=>a.ordinal-b.ordinal),create:async({data})=>{const unit={...data,id:nextUnit++,serialNumber:null,status:'REQUESTED',deployedAt:null,returnedAt:null,inventoryLocation:null};state.units.push(unit);return unit;},update:async({where,data})=>{const unit=state.units.find(item=>item.id===where.id);Object.assign(unit,data);return unit;},deleteMany:async({where})=>{state.units=state.units.filter(unit=>!where.id.in.includes(unit.id));}},
  };
  client.$transaction=async callback=>{const snapshot=structuredClone(state);try{return await callback(client);}catch(error){state.requests=snapshot.requests;state.items=snapshot.items;state.units=snapshot.units;state.revisions=snapshot.revisions;throw error;}};
  return client;
}
const group=(plan,id)=>plan.groups.find(item=>item.requestId===id);
const first=parsed.rows[0],shipped=parsed.rows[1],par=parsed.rows.filter(item=>item.values.VAR==='PAR'),ups=parsed.rows.filter(item=>item.values.VAR==='UPS');

test('authoritative Demo fixture has exact headers, 8 rows, 6 requests, and two grouped item sets',()=>{
  assert.deepEqual(parsed.errors,[]);assert.equal(demoHeaders.length,22);assert.deepEqual(demoHeaders,['Request ID','Demo Number','Status','Requested At','Requested By','Reviewed At','Reviewed By','VAR','Shipping Address','Shipping Carrier','Carrier Account Number','SKU / Model','Quantity','Serial Numbers','Tracking Numbers','Inventory Locations','Shipped At','Shipped By','Duration Value','Duration Unit','Notes','Approval Comments']);
  assert.equal(parsed.rows.length,8);const groups=new Map();for(const item of parsed.rows){const key=item.values['Request ID'];groups.set(key,[...(groups.get(key)??[]),item]);}assert.equal(groups.size,6);assert.deepEqual([...groups.values()].filter(rows=>rows.length>1).map(rows=>rows.map(row=>row.values['SKU / Model'])),[['XD5-40dEK','XL5-40CtEG'],['PM5-UPSDP','XM7-40RFIWK/UPS']]);assert.equal([...groups.values()].filter(rows=>!rows[0].values['Demo Number']).length,4);assert.equal([...groups.values()].filter(rows=>rows[0].values.Status==='shipped').length,4);
});
test('one row forms one request; blank Demo Number is valid and source key stays Request ID',async()=>{const client=db(),plan=await planDemoImport(client,input(first),'demo.csv');assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].disposition,'Ready to import');assert.equal(plan.groups[0].demoNumber,'');assert.equal(plan.groups[0].requestId,first.values['Request ID']);assert.equal(stateCount(client),0);});
test('Demo preview formats dates, item counts, shipping, and Account issues for display',async()=>{
  const one=(await planDemoImport(db(),input(first),'demo.csv')).groups[0];
  assert.equal(demoPreviewDate('2026-09-25T00:00:00.000Z'),'Sep 25, 2026');
  assert.equal(demoPreviewDate(one.requestedAt),new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(one.requestedAt)));
  assert.equal(demoPreviewItemSummary(one),'1 line · 1 unit');
  assert.equal(demoPreviewShipping(one),'Not shipped');
  const two={...one,items:[...one.items,{...one.items[0],quantity:3}],shippedAt:'2026-09-25T14:00:00.000Z',header:{...one.header,'Shipping Carrier':'UPS'}};
  assert.equal(demoPreviewItemSummary(two),'2 lines · 4 units');
  assert.equal(demoPreviewShipping(two),'Sep 25, 2026 · UPS');
  assert.equal(demoPreviewShipping({...two,items:two.items.map(item=>({...item,trackingNumbers:['1Z123']}))}),'Sep 25, 2026 · UPS · Tracking: 1Z123');
  const unmatched=(await planDemoImport(db({accounts:[]}),input(first),'demo.csv')).groups[0];
  assert.equal(demoPreviewIssue('VAR: No CRM match.',unmatched),'Account match: Not found');
  assert.equal(demoPreviewIssue('VAR differs across source rows.',unmatched),'Customer differs across source rows.');
  assert.equal(demoPreviewFieldLabel('VAR'),'Customer');
  assert.equal(unmatched.account.issue,'No CRM match.');
});
test('same Request ID groups items, while same customer with different Request IDs stays separate',async()=>{const client=db(),plan=await planDemoImport(client,parsed,'demo.csv');assert.equal(plan.groups.length,6);assert.equal(plan.groups.filter(item=>item.items.length===2).length,2);assert.equal(plan.groups.filter(item=>item.header.VAR==='CoreGroup Displays').length,2);assert.equal(group(plan,par[0].values['Request ID']).items.length,2);assert.equal(group(plan,ups[0].values['Request ID']).items.length,2);assert.equal(plan.groups.some(item=>item.conflicts.length>0),false);});
test('serials, tracking, and locations are separate lists without losing duplicate source values',async()=>{const item=(await planDemoImport(db(),input(shipped),'demo.csv')).groups[0].items[0];assert.deepEqual(item.serialNumbers,['USANNBKA26060001','USANNBKA26060002']);assert.deepEqual(item.trackingNumbers,['535005300502','535005300502']);assert.deepEqual(item.inventoryLocations,['HQ B12:A1','HQ B12:A1']);assert.equal(item.raw['Tracking Numbers'],shipped.values['Tracking Numbers']);});
test('exact SKU auto-matches and one reviewed SKU choice applies to repeated source values',async()=>{
  const exact=await planDemoImport(db(),input(first),'demo.csv');
  assert.equal(exact.groups[0].items[0].sku.name,first.values['SKU / Model']);
  assert.equal(exact.groups[0].disposition,'Ready to import');
  const second=parsed.rows.find(item=>item.values['Request ID']!==first.values['Request ID']);
  const source=input(row(first,{'SKU / Model':'ROSA-NEW'}),row(second,{'SKU / Model':'ROSA-NEW'}));
  const catalogSkus=[...sourceSkus],client=db({skus:catalogSkus});
  const initial=await planDemoImport(client,source,'demo.csv');
  assert.equal(initial.counts['Needs review'],2);
  const existingSkuId=catalogSkus.indexOf(first.values['SKU / Model'])+1;
  const selected=mapDemoSourceSku(initial,{},first.values['Request ID'],first.line,existingSkuId);
  assert.equal(Object.keys(selected).length,2);
  const reviewed=await planDemoImport(client,source,'demo.csv',selected);
  assert.equal(reviewed.counts['Ready to import'],2);
  await applyDemoImport(client,source,'demo.csv',reviewed.digest,true,100,selected);
  assert.ok(client.state.items.every(item=>item.sourceSku==='ROSA-NEW'&&item.productSkuId===existingSkuId&&item.sourceValues['SKU / Model']==='ROSA-NEW'));
  assert.ok(client.state.revisions.every(revision=>revision.sourceRows[0].values['SKU / Model']==='ROSA-NEW'));
});
test('new catalog SKU immediately makes every matching Demo request ready without re-upload',async()=>{
  const second=parsed.rows.find(item=>item.values['Request ID']!==first.values['Request ID']);
  const source=input(row(first,{'SKU / Model':'ROSA-NEW'}),row(second,{'SKU / Model':'ROSA-NEW'}));
  const catalogSkus=[...sourceSkus],client=db({skus:catalogSkus});
  const initial=await planDemoImport(client,source,'demo.csv');
  assert.equal(initial.counts['Needs review'],2);
  catalogSkus.push('CRM-NEW');
  const refreshed=await planDemoImport(client,source,'demo.csv');
  const choices=mapDemoSourceSku(refreshed,{},first.values['Request ID'],first.line,catalogSkus.length);
  const ready=await planDemoImport(client,source,'demo.csv',choices);
  assert.equal(ready.counts['Ready to import'],2);
  assert.ok(ready.groups.every(group=>group.items[0].sku.name==='CRM-NEW'&&group.items[0].sourceSku==='ROSA-NEW'));
});
test('unresolved Account, user, and SKU need explicit choices; optional blank users do not',async()=>{for(const [overrides,field] of [[{accounts:[]},'VAR'],[{users:sourceUsers.filter(name=>name!=='Amber')},'Requested By'],[{skus:[]},'SKU']]){const plan=await planDemoImport(db(overrides),input(first),'demo.csv');assert.equal(plan.groups[0].disposition,'Needs review');assert.match(plan.groups[0].issues.join(' '),new RegExp(field));}const plan=await planDemoImport(db(),input(first),'demo.csv');assert.equal(plan.groups[0].users['Shipped By'].issue,null);});
test('unmatched Reviewed By imports without manual selection and retains source provenance',async()=>{
  const source=input(row(first,{'Reviewed By':'Gary'})),client=db({users:sourceUsers.filter(name=>name!=='Gary')});
  const plan=await planDemoImport(client,source,'demo.csv');
  assert.equal(plan.counts['Ready to import'],1);
  assert.equal(plan.counts['Needs review'],0);
  assert.deepEqual(plan.groups[0].issues,[]);
  assert.deepEqual(plan.groups[0].users['Reviewed By'],{source:'Gary',id:null,name:null,issue:null});
  assert.equal((await applyDemoImport(client,source,'demo.csv',plan.digest,true,100)).created,1);
  assert.equal(client.state.requests[0].reviewedById,null);
  assert.equal(client.state.requests[0].sourceHeader['Reviewed By'],'Gary');
  assert.equal(client.state.revisions[0].sourceRows[0].values['Reviewed By'],'Gary');
  assert.equal(client.state.revisions[0].reviewedMappings.userIds['Reviewed By'],null);
});
test('deterministic Reviewed By match retains CRM relationship; requester and Account still block',async()=>{
  const source=input(row(first,{'Reviewed By':'Gary'})),client=db({users:[...new Set([...sourceUsers,'Gary'])]});
  const plan=await planDemoImport(client,source,'demo.csv');
  const reviewerId=plan.groups[0].users['Reviewed By'].id;
  assert.equal(plan.groups[0].disposition,'Ready to import');
  assert.ok(reviewerId);
  await applyDemoImport(client,source,'demo.csv',plan.digest,true,100);
  assert.equal(client.state.requests[0].reviewedById,reviewerId);
  assert.equal(client.state.revisions[0].reviewedMappings.userIds['Reviewed By'],reviewerId);
  for(const [options,issue] of [[{users:sourceUsers.filter(name=>name!=='Amber'&&name!=='Gary')},'Requested By'],[{accounts:[]},'VAR']]){
    const blocked=await planDemoImport(db(options),source,'demo.csv');
    assert.equal(blocked.groups[0].disposition,'Needs review');
    assert.match(blocked.groups[0].issues.join(' '),new RegExp(issue));
    assert.doesNotMatch(blocked.groups[0].issues.join(' '),/Reviewed By/);
  }
});
test('unmatched Shipped By imports without a manual user choice and preserves source provenance',async()=>{
  const source=input(row(shipped,{'Shipped By':'Jorge'})),client=db({users:sourceUsers.filter(name=>name!=='Jorge')});
  const plan=await planDemoImport(client,source,'demo.csv');
  assert.equal(plan.groups[0].disposition,'Ready to import');
  assert.deepEqual(plan.groups[0].issues,[]);
  assert.deepEqual(plan.groups[0].users['Shipped By'],{source:'Jorge',id:null,name:null,issue:null});
  assert.equal((await applyDemoImport(client,source,'demo.csv',plan.digest,true,100)).created,1);
  assert.equal(client.state.requests[0].shippedById,null);
  assert.equal(client.state.requests[0].sourceHeader['Shipped By'],'Jorge');
  assert.equal(client.state.revisions[0].sourceRows[0].values['Shipped By'],'Jorge');
  assert.equal(client.state.revisions[0].reviewedMappings.userIds['Shipped By'],null);
});
test('deterministic Shipped By match retains CRM relationship; unrelated issues still block',async()=>{
  const source=input(row(shipped,{'Shipped By':'Jorge'})),client=db({users:[...new Set([...sourceUsers,'Jorge'])]});
  const plan=await planDemoImport(client,source,'demo.csv');
  assert.equal(plan.groups[0].disposition,'Ready to import');
  const shipperId=plan.groups[0].users['Shipped By'].id;
  assert.ok(shipperId);
  await applyDemoImport(client,source,'demo.csv',plan.digest,true,100);
  assert.equal(client.state.requests[0].shippedById,shipperId);
  assert.equal(client.state.revisions[0].reviewedMappings.userIds['Shipped By'],shipperId);
  const missingSku=await planDemoImport(db({skus:[],users:sourceUsers.filter(name=>name!=='Jorge')}),source,'demo.csv');
  assert.equal(missingSku.groups[0].disposition,'Needs review');
  assert.match(missingSku.groups[0].issues.join(' '),/SKU/);
  assert.doesNotMatch(missingSku.groups[0].issues.join(' '),/Shipped By/);
});
test('manual choices resolve review without changing source strings',async()=>{const client=db({accounts:['Other'],users:['Other'],skus:['Other']}),id=first.values['Request ID'];const plan=await planDemoImport(client,input(first),'demo.csv',{[id]:{accountId:1,userIds:{'Requested By':1,'Reviewed By':1},skuIds:{[first.line]:1}}});assert.equal(plan.groups[0].disposition,'Ready to import');assert.equal(plan.groups[0].header.VAR,first.values.VAR);assert.equal(plan.groups[0].items[0].sourceSku,first.values['SKU / Model']);});
test('selecting an existing Account maps the same unresolved source across distinct CoreGroup requests',async()=>{
  const core=parsed.rows.filter(item=>item.values.VAR==='CoreGroup Displays'),client=db({accounts:['CoreGroup CRM']}),source=input(...core),prior=await planDemoImport(client,source,'demo.csv');
  assert.equal(prior.groups.length,2);assert.ok(prior.groups.every(item=>item.account.issue));
  const choices=mapDemoSourceAccount(prior,{},core[0].values['Request ID'],1),reviewed=await planDemoImport(client,source,'demo.csv',choices);
  assert.equal(Object.keys(choices).length,2);assert.ok(reviewed.groups.every(item=>item.disposition==='Ready to import'&&item.account.id===1));
  assert.ok(reviewed.groups.every(item=>item.header.VAR==='CoreGroup Displays'));
  await applyDemoImport(client,source,'demo.csv',reviewed.digest,true,100,choices);
  assert.equal(client.state.requests.length,2);assert.ok(client.state.requests.every(item=>item.accountId===1));
  assert.ok(client.state.revisions.every(item=>item.reviewedMappings.accountId===1&&item.sourceRows[0].values.VAR==='CoreGroup Displays'));
});
test('a newly created Account resolves the current Demo preview and retains original VAR evidence',async()=>{
  const core=parsed.rows.filter(item=>item.values.VAR==='CoreGroup Displays'),accounts=[],client=db({accounts}),source=input(...core),prior=await planDemoImport(client,source,'demo.csv');
  assert.equal(prior.counts['Needs review'],2);
  accounts.push('CoreGroup CRM');
  const refreshed=await planDemoImport(client,source,'demo.csv'),choices=mapDemoSourceAccount(refreshed,{},core[0].values['Request ID'],1),reviewed=await planDemoImport(client,source,'demo.csv',choices);
  assert.equal(reviewed.counts['Ready to import'],2);assert.ok(reviewed.groups.every(item=>item.account.name==='CoreGroup CRM'));
  await applyDemoImport(client,source,'demo.csv',reviewed.digest,true,100,choices);
  assert.equal(client.state.requests.length,2);assert.ok(client.state.revisions.every(item=>item.sourceRows[0].values.VAR==='CoreGroup Displays'&&item.reviewedMappings.accountId===1));
});
test('conflicting grouped header requires review and explicit source-row selection',async()=>{const changed=row(par[1],{VAR:'Another VAR'}),client=db({accounts:[...names,'Another VAR']}),id=par[0].values['Request ID'];const prior=await planDemoImport(client,input(par[0],changed),'demo.csv');assert.equal(prior.groups[0].disposition,'Needs review');assert.ok(prior.groups[0].conflicts.some(item=>item.field==='VAR'));const reviewed=await planDemoImport(client,input(par[0],changed),'demo.csv',{[id]:{headerLines:{VAR:par[0].line}}});assert.equal(reviewed.groups[0].disposition,'Ready to import');});
test('malformed row stays an error even if another grouped header value is selected',async()=>{const bad=row(par[1],{Status:'unknown'}),id=par[0].values['Request ID'];const plan=await planDemoImport(db(),input(par[0],bad),'demo.csv',{[id]:{headerLines:{Status:par[0].line}}});assert.equal(plan.groups[0].disposition,'Error');});
test('apply creates one header and two items atomically, then identical re-import writes nothing',async()=>{const client=db(),source=input(...par),plan=await planDemoImport(client,source,'demo.csv');await applyDemoImport(client,source,'demo.csv',plan.digest,true,100);assert.equal(stateCount(client),1);assert.equal(client.state.items.length,2);assert.equal(client.state.revisions.length,1);assert.deepEqual(client.state.revisions[0].sourceRowNumbers,par.map(item=>item.line));assert.equal((await planDemoImport(client,source,'demo.csv')).groups[0].disposition,'Already imported / No changes');const again=await planDemoImport(client,source,'demo.csv');const result=await applyDemoImport(client,source,'demo.csv',again.digest,true,100);assert.equal(result.created+result.updated,0);assert.equal(client.state.items.length,2);});
test('later Demo Number and approved to shipped progression updates same request and retains revision',async()=>{const client=db(),source=input(first),prior=await planDemoImport(client,source,'demo.csv');await applyDemoImport(client,source,'demo.csv',prior.digest,true,100);const next=row(first,{'Demo Number':'DEMO093026-1',Status:'shipped','Shipped At':'2026-09-30T14:00:00+00:00','Shipped By':'Jorge','Serial Numbers':'ABC123','Tracking Numbers':'1Z123','Inventory Locations':'HQ A1'},first.line);const update=input(next),preview=await planDemoImport(client,update,'later.csv');assert.equal(preview.groups[0].disposition,'Source update available');assert.ok(preview.groups[0].changes.some(item=>item.field==='Demo Number'&&item.before==='—'));assert.ok(preview.groups[0].changes.some(item=>item.field==='Status'&&item.after==='shipped'));assert.ok(preview.groups[0].changes.some(item=>item.field.startsWith('Serial Numbers')));assert.ok(preview.groups[0].changes.some(item=>item.field.startsWith('Tracking Numbers')));await applyDemoImport(client,update,'later.csv',preview.digest,true,100,{},[first.values['Request ID']]);assert.equal(stateCount(client),1);assert.equal(client.state.revisions.length,2);assert.equal(client.state.requests[0].demoNumber,'DEMO093026-1');assert.deepEqual(client.state.items[0].serialNumbers,['ABC123']);assert.deepEqual(client.state.items[0].trackingNumbers,['1Z123']);assert.deepEqual(client.state.items[0].inventoryLocations,['HQ A1']);});
test('new cancelled source row normalizes case and retains exact source status',async()=>{
  for(const sourceStatus of ['cancelled','CANCELLED','CaNcElLeD']){
    const client=db(),source=input(row(first,{Status:sourceStatus})),plan=await planDemoImport(client,source,'cancelled.csv');
    assert.equal(plan.groups[0].disposition,'Ready to import');
    assert.equal(plan.groups[0].status,'CANCELLED');
    assert.deepEqual(await applyDemoImport(client,source,'cancelled.csv',plan.digest,true,100),{created:1,updated:0,skipped:0});
    assert.equal(client.state.requests[0].status,'CANCELLED');
    assert.equal(client.state.requests[0].sourceHeader.Status,sourceStatus);
    assert.equal(client.state.revisions[0].sourceRows[0].values.Status,sourceStatus);
    assert.equal(client.state.units[0].deployedAt,null);
  }
});
test('approved to cancelled is a reviewed update on the same request with append-only revisions',async()=>{
  const client=db(),original=input(first),prior=await planDemoImport(client,original,'approved.csv');
  await applyDemoImport(client,original,'approved.csv',prior.digest,true,100);
  const changed=input(row(first,{Status:'cancelled'})),preview=await planDemoImport(client,changed,'cancelled.csv');
  assert.equal(preview.groups[0].disposition,'Source update available');
  assert.ok(preview.groups[0].changes.some(change=>change.field==='Status'&&change.before==='APPROVED'&&change.after==='cancelled'));
  assert.equal((await applyDemoImport(client,changed,'cancelled.csv',preview.digest,true,100)).updated,0);
  assert.equal((await applyDemoImport(client,changed,'cancelled.csv',preview.digest,true,100,{},[first.values['Request ID']])).updated,1);
  assert.equal(client.state.requests.length,1);
  assert.equal(client.state.requests[0].status,'CANCELLED');
  assert.equal(client.state.units[0].status,'APPROVED');
  assert.equal(client.state.revisions.length,2);
  assert.deepEqual(client.state.revisions.map(revision=>revision.sourceRows[0].values.Status),[first.values.Status,'cancelled']);
  const repeat=await planDemoImport(client,changed,'cancelled.csv');
  assert.equal(repeat.groups[0].disposition,'Already imported / No changes');
  assert.equal((await applyDemoImport(client,changed,'cancelled.csv',repeat.digest,true,100)).updated,0);
  assert.equal(client.state.requests.length,1);
  assert.equal(client.state.revisions.length,2);
});
test('cancelled source with shipment retains deployed units and CRM returns on reimport',async()=>{
  const client=db(),source=input(shipped),prior=await planDemoImport(client,source,'shipped.csv');
  await applyDemoImport(client,source,'shipped.csv',prior.digest,true,100);
  client.state.units[0].returnedAt=new Date('2026-10-01T12:00:00Z');client.state.units[0].status='RETURNED';
  const cancelled=input(row(shipped,{Status:'cancelled'})),preview=await planDemoImport(client,cancelled,'cancelled.csv');
  assert.equal(preview.groups[0].disposition,'Source update available');
  await applyDemoImport(client,cancelled,'cancelled.csv',preview.digest,true,100,{},[shipped.values['Request ID']]);
  assert.equal(client.state.requests.length,1);
  assert.equal(client.state.requests[0].status,'CANCELLED');
  assert.deepEqual(client.state.units.map(unit=>unit.status),['RETURNED','DEPLOYED']);
  assert.equal(client.state.units[0].returnedAt.toISOString(),'2026-10-01T12:00:00.000Z');
  assert.ok(client.state.units.every(unit=>unit.deployedAt));
  assert.equal(client.state.revisions.length,2);
  const newClient=db(),newPlan=await planDemoImport(newClient,cancelled,'cancelled.csv');
  await applyDemoImport(newClient,cancelled,'cancelled.csv',newPlan.digest,true,100);
  assert.ok(newClient.state.units.every(unit=>unit.status==='DEPLOYED'&&unit.deployedAt));
});
test('shipped to cancelled remains a valid source update when cancellation clears shipping fields',async()=>{
  const client=db(),source=input(shipped),prior=await planDemoImport(client,source,'shipped.csv');
  await applyDemoImport(client,source,'shipped.csv',prior.digest,true,100);
  const cancelled=input(row(shipped,{Status:'cancelled','Shipped At':'','Shipped By':''}));
  const preview=await planDemoImport(client,cancelled,'cancelled.csv');
  assert.equal(preview.groups[0].disposition,'Source update available');
  await applyDemoImport(client,cancelled,'cancelled.csv',preview.digest,true,100,{},[shipped.values['Request ID']]);
  assert.equal(client.state.requests[0].shippedAt,null);
  assert.equal(client.state.requests[0].status,'CANCELLED');
  assert.ok(client.state.units.every(unit=>unit.status==='DEPLOYED'&&unit.deployedAt));
});
test('unknown source status remains an Error for new and existing requests',async()=>{
  const unknown=input(row(first,{Status:'withdrawn'}));
  assert.equal((await planDemoImport(db(),unknown,'unknown.csv')).groups[0].disposition,'Error');
  const client=db(),prior=await planDemoImport(client,input(first),'approved.csv');
  await applyDemoImport(client,input(first),'approved.csv',prior.digest,true,100);
  const preview=await planDemoImport(client,unknown,'unknown.csv');
  assert.equal(preview.groups[0].disposition,'Error');
  assert.match(preview.groups[0].issues.join(' '),/Unsupported source status: withdrawn/);
});
test('lifecycle preview compares source against live CRM notes',async()=>{const client=db(),source=input(first),prior=await planDemoImport(client,source,'demo.csv');await applyDemoImport(client,source,'demo.csv',prior.digest,true,100);client.state.requests[0].notes='Sales follow-up note';const next=input(row(first,{'Demo Number':'DEMO093026-1'}));const preview=await planDemoImport(client,next,'later.csv');assert.ok(preview.groups[0].changes.some(change=>change.field==='Notes'&&change.before==='Sales follow-up note'));});
test('changed item set is reviewed and old line is retired with source history retained',async()=>{const client=db(),source=input(...par),prior=await planDemoImport(client,source,'demo.csv');await applyDemoImport(client,source,'demo.csv',prior.digest,true,100);const changed=input(par[0]);const preview=await planDemoImport(client,changed,'later.csv');assert.equal(preview.groups[0].disposition,'Source update available');assert.ok(preview.groups[0].changes.some(item=>item.field==='Demo Items'));await applyDemoImport(client,changed,'later.csv',preview.digest,true,100,{},[par[0].values['Request ID']]);assert.equal(client.state.items.filter(item=>!item.retiredAt).length,1);assert.equal(client.state.items.length,2);assert.equal(client.state.revisions.length,2);});
test('older source does not roll shipped state back to approved',async()=>{const client=db(),current=input(shipped),prior=await planDemoImport(client,current,'demo.csv');await applyDemoImport(client,current,'demo.csv',prior.digest,true,100);const older=input(row(shipped,{Status:'approved','Shipped At':'','Shipped By':'','Tracking Numbers':''}));const preview=await planDemoImport(client,older,'older.csv');assert.equal(preview.groups[0].disposition,'Older source submission detected');const result=await applyDemoImport(client,older,'older.csv',preview.digest,true,100);assert.equal(result.updated,0);assert.equal(client.state.requests[0].status,'SHIPPED');});
test('partial prior import leaves remaining requests ready',async()=>{const client=db(),one=input(first),prior=await planDemoImport(client,one,'demo.csv');await applyDemoImport(client,one,'demo.csv',prior.digest,true,100);const full=await planDemoImport(client,parsed,'demo.csv');assert.equal(full.counts['Already imported / No changes'],1);assert.equal(full.counts['Ready to import'],5);});
test('confirmation, stale digest, and transaction rollback prevent partial writes',async()=>{const client=db(),source=input(...par),plan=await planDemoImport(client,source,'demo.csv');await assert.rejects(applyDemoImport(client,source,'demo.csv',plan.digest,false,100),/Confirm/);await assert.rejects(applyDemoImport(client,source,'demo.csv','stale',true,100),/Preview changed/);client.setFailItem(true);await assert.rejects(applyDemoImport(client,source,'demo.csv',plan.digest,true,100),/Item write failed/);assert.equal(stateCount(client),0);assert.equal(client.state.items.length,0);assert.equal(client.state.revisions.length,0);});
function stateCount(client){return client.state.requests.length;}
test('standalone Demo directory and importer are Admin only; permitted detail and Account entry remain available',()=>{const sales={id:1,role:'SALES',active:true,archivedAt:null};assert.equal(permissionForPath('/demos'),'sales.read');for(const role of ['SALES_MANAGER','SALES','READ_ONLY']){const actor={...sales,role};assert.equal(routeAccess('/demos',actor),'denied');assert.equal(routeAccess('/administration/imports/demos',actor),'denied');assert.equal(routeAccess('/administration/imports/demos/backfill',actor),'denied');assert.equal(routeAccess('/demos/12',actor),'allowed');assert.equal(routeAccess('/accounts/1',actor),'allowed');assert.equal(can(actor,'accounts.read'),true);assert.deepEqual(demoReadWhere(actor),{});}assert.equal(routeAccess('/demos/new',sales),'denied');assert.equal(routeAccess('/demos/new',{...sales,role:'READ_ONLY'}),'denied');assert.equal(can({...sales,role:'READ_ONLY'},'sales.write'),false);const admin={...sales,role:'ADMIN'};assert.equal(routeAccess('/demos/new',admin),'denied');assert.equal(routeAccess('/administration/imports/demos/backfill',admin),'allowed');assert.equal(routeAccess('/demos',admin),'allowed');assert.equal(routeAccess('/administration/imports/demos',admin),'allowed');});

test('Account is required while Project and Opportunity are independently optional and Account compatible',async()=>{
  const actor={id:7,role:'SALES',active:true,archivedAt:null};
  const mock={
    account:{findFirst:async({where})=>where.id===1?{id:1}:null},
    project:{findFirst:async({where})=>where.AND[0].id===10&&where.AND[1].AND[1].OR[0].primaryAccountId===1?{id:10,ownerId:7,primaryAccount:{ownerId:7}}:null},
    opportunity:{findFirst:async({where})=>where.id===20&&where.participants.some.accountId===1&&where.ownerId===7?{id:20}:null},
  };
  for(const [projectId,opportunityId] of [[null,null],[10,null],[null,20],[10,20]])await assert.doesNotReject(assertDemoContext(mock,actor,1,projectId,opportunityId));
  await assert.rejects(assertDemoContext(mock,actor,2,null,null),/active Account/);
  await assert.rejects(assertDemoContext(mock,actor,1,11,null),/Project is not available/);
  await assert.rejects(assertDemoContext(mock,actor,1,null,21),/Opportunity is not available/);
  await assert.rejects(assertDemoContext(mock,{...actor,role:'READ_ONLY'},1,null,null),/Access denied/);
  assert.equal(demoLabel({id:1,demoNumber:null,sourceRequestId:'560fbee9-9b3b-48a9-990a-720adc67291c'}),'Pending Demo');
});

test('source Account change cannot strand linked Project or Opportunity context',async()=>{
  const client=db({accounts:[...names,'Other Account']});
  const source=input(first),prior=await planDemoImport(client,source,'demo.csv');
  await applyDemoImport(client,source,'demo.csv',prior.digest,true,100);
  client.state.requests[0].projectId=12;
  const changed=input(row(first,{VAR:'Other Account'}));
  const preview=await planDemoImport(client,changed,'later.csv');
  assert.equal(preview.groups[0].disposition,'Needs review');
  assert.match(preview.groups[0].issues.join(' '),/unlink business context/);
  const result=await applyDemoImport(client,changed,'later.csv',preview.digest,true,100);
  assert.equal(result.updated,0);
  assert.equal(client.state.requests[0].accountId,1);
});

test('unit slots reconcile later serials without changing quantity or CRM returns',async()=>{
  const client=db();
  const initial=input(row(shipped,{'Serial Numbers':''}));
  const firstPlan=await planDemoImport(client,initial,'initial.csv');
  await applyDemoImport(client,initial,'initial.csv',firstPlan.digest,true,100);
  assert.equal(client.state.units.length,2);
  assert.equal(client.state.units.filter(unit=>unit.status==='DEPLOYED').length,2);
  client.state.units[0].status='RETURNED';client.state.units[0].returnedAt=new Date('2026-09-25T12:00:00Z');
  const later=input(row(shipped,{'Serial Numbers':'USANNBKA26060001;USANNBKA26060002'}));
  const laterPlan=await planDemoImport(client,later,'later.csv');
  assert.equal(laterPlan.groups[0].disposition,'Source update available');
  await applyDemoImport(client,later,'later.csv',laterPlan.digest,true,100,{},[shipped.values['Request ID']]);
  assert.equal(client.state.units.length,2);
  assert.deepEqual(client.state.units.map(unit=>unit.serialNumber),['USANNBKA26060001','USANNBKA26060002']);
  assert.deepEqual(client.state.units.map(unit=>unit.status),['RETURNED','DEPLOYED']);
  assert.equal(client.state.units[0].returnedAt.toISOString(),'2026-09-25T12:00:00.000Z');
  assert.ok(client.state.units.every(unit=>unit.deployedAt));
  assert.deepEqual(client.state.units.map(unit=>unit.inventoryLocation),['HQ B12:A1','HQ B12:A1']);
  assert.deepEqual(client.state.items[0].trackingNumbers,['535005300502','535005300502']);
});
test('serial count above quantity or duplicate serials is rejected in preview',async()=>{
  for(const serials of ['A;B;C','A;A']){
    const plan=await planDemoImport(db(),input(row(shipped,{'Serial Numbers':serials})),'invalid.csv');
    assert.equal(plan.groups[0].disposition,'Error');
    assert.match(plan.groups[0].issues.join(' '),/serials must be unique/);
  }
});
