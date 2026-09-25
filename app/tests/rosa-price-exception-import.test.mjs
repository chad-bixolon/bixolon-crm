import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import Module from 'node:module';import path from 'node:path';import ts from 'typescript';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);const require=Module.createRequire(fileURLToPath(import.meta.url));
const {parseRosaCsv,parseRosaExpirationDate,planRosaPriceExceptions,applyRosaPriceExceptions}=require(path.join(root,'lib/rosa-price-exception-import.ts'));
const fixture=fs.readFileSync(path.join(root,'../reference-data/price-exceptions-2026-09-25.csv'),'utf8');
const sourceRows=parseRosaCsv(fixture).rows,first=sourceRows[0];
const seed={users:[{id:1,firstName:'Amber',lastName:'Smith',role:'SALES',active:true,archivedAt:null},{id:2,firstName:'Ryan',lastName:'Jones',role:'SALES',active:true,archivedAt:null},{id:3,firstName:'Gary',lastName:'Lee',role:'ADMIN',active:true,archivedAt:null}],accounts:[{id:10,name:'Bluestar',status:'ACTIVE',archivedAt:null},{id:11,name:'Sonda in Chile',status:'ACTIVE',archivedAt:null},{id:12,name:'Falabella Stores',status:'ACTIVE',archivedAt:null}],skus:[{id:20,partNumber:'SRP-350PlusVK',normalizedPartNumber:'SRP-350PLUSVK',active:true,product:{active:true,archivedAt:null}},{id:21,partNumber:'SECOND-SKU',normalizedPartNumber:'SECOND-SKU',active:true,product:{active:true,archivedAt:null}}],currencies:[{code:'USD',active:true}],existing:[]};
function db(overrides={}){const source={...seed,...overrides,existing:[...(overrides.existing??seed.existing)]},writes=[];const client={writes,source,user:{findMany:async()=>source.users,findUnique:async({where})=>source.users.find(user=>user.id===where.id)??null},account:{findMany:async()=>source.accounts},productSku:{findMany:async()=>source.skus},currency:{findMany:async()=>source.currencies},priceException:{findMany:async()=>source.existing,create:async({data})=>{writes.push(data);source.existing.push({id:writes.length,peCode:data.peCode,sourceType:data.sourceType,sourceKey:data.sourceKey,sourceMetadata:data.sourceMetadata,lines:data.lines.create.map(line=>({...line}))});return {id:writes.length}}}};client.$transaction=async callback=>callback(client);return client}
const row=(line,changes={})=>({line,values:{...first.values,...changes}}),parsed=(...rows)=>({rows,errors:[]});
test('one PE with one line is READY, dry-run writes nothing, and preserves header values',async()=>{const client=db(),plan=await planRosaPriceExceptions(client,parsed(row(2)),'rosa.csv'),group=plan.groups[0];assert.equal(client.writes.length,0);assert.equal(plan.sourceRowCount,1);assert.equal(plan.groups.length,1);assert.equal(group.disposition,'READY');assert.equal(group.tiers.length,1);assert.equal(group.tiers[0].sku.id,20);assert.equal(group.requestedBy.name,'Amber Smith');assert.equal(group.reviewedBy.name,'Gary Lee');assert.equal(group.statusMapped,'ACTIVE');assert.equal(group.requestedAt,first.values['Requested At']);assert.equal(group.description,first.values.Description)});
test('expiration dates parse explicit slash formats and validate leap days and year bounds',()=>{for(const [source,expected] of [['6/30/27','2027-06-30'],['12/31/26','2026-12-31'],['06/30/2027','2027-06-30'],['2/29/24','2024-02-29'],['2/29/2000','2000-02-29'],['2027-06-30','2027-06-30'],['3027-06-30',null],['2/29/27',null],['2/29/1900',null],['02/30/2027',null],['13/01/27',null],['6/31/27',null],['6/30/7',null],['not a date',null]])assert.equal(parseRosaExpirationDate(source),expected,source)});
test('slash expiration dates import as canonical dates while retaining the original source value',async()=>{const input=parsed(row(2,{'Expiration Date':'6/30/27'}),row(3,{'Expiration Date':'06/30/2027',Quantity:'250'})),client=db();const plan=await planRosaPriceExceptions(client,input,'rosa.csv');assert.equal(plan.groups[0].disposition,'READY');assert.deepEqual(plan.groups[0].conflictingFields,[]);assert.equal(plan.groups[0].expirationDate,'2027-06-30');await applyRosaPriceExceptions(client,input,'rosa.csv',plan.digest,true,91);assert.equal(client.writes[0].expirationDate.toISOString(),'2027-06-30T00:00:00.000Z');assert.deepEqual(client.writes[0].sourceMetadata.rosaRawRows.map(row=>row.values['Expiration Date']),['6/30/27','06/30/2027'])});
test('unmatched Account parties require review and keep every source name without creating Accounts',async()=>{for(const role of ['Customer','VAR','End User']){const accounts=seed.accounts.filter(account=>account.name!==first.values[role]);const client=db({accounts}),plan=await planRosaPriceExceptions(client,parsed(row(2)),'rosa.csv'),group=plan.groups[0];assert.equal(group.disposition,'REVIEW REQUIRED',role);assert.ok(group.messages.some(message=>message.includes(`${role}: No CRM match.`)),role);assert.equal(group[role==='Customer'?'customer':role==='VAR'?'varAccount':'endUser'].source,first.values[role]);assert.equal(client.writes.length,0)}});
test('three quantity tiers for the same SKU create one header and three distinct lines',async()=>{const input=parsed(row(2,{Quantity:'100','Approved Price':'180.00'}),row(3,{Quantity:'250','Approved Price':'170.00'}),row(4,{Quantity:'500','Approved Price':'160.00'})),client=db();const plan=await planRosaPriceExceptions(client,input,'rosa.csv');assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].disposition,'READY');assert.equal(plan.groups[0].tiers.length,3);assert.equal(new Set(plan.groups[0].tiers.map(tier=>tier.sourceLineKey)).size,3);const result=await applyRosaPriceExceptions(client,input,'rosa.csv',plan.digest,true,91);assert.deepEqual([result.created,result.lines],[1,3]);assert.equal(client.writes.length,1);const lines=client.writes[0].lines.create;assert.deepEqual(lines.map(line=>line.sourceQuantity.toString()),['100','250','500']);assert.deepEqual(lines.map(line=>line.approvedUnitPrice.toString()),['180','170','160']);assert.ok(lines.every(line=>line.productSkuId===20));assert.deepEqual(lines.map(line=>line.sourceMetadata.sourceLine),[2,3,4]);assert.deepEqual(lines.map(line=>line.sourceMetadata.originalPrice),['193.60','193.60','193.60'])});
test('multiple SKUs under the same PE become separate lines',async()=>{const input=parsed(row(2),row(3,{SKU:'SECOND-SKU',Quantity:'250'})),client=db();const plan=await planRosaPriceExceptions(client,input,'rosa.csv');assert.equal(plan.groups[0].disposition,'READY');await applyRosaPriceExceptions(client,input,'rosa.csv',plan.digest,true,91);assert.deepEqual(client.writes[0].lines.create.map(line=>line.productSkuId),[20,21])});
test('meaningful header conflicts block the whole PE and name each field; harmless description whitespace does not',async()=>{const consistent=await planRosaPriceExceptions(db(),parsed(row(2),row(3,{Description:`  ${first.values.Description}   `})),'rosa.csv');assert.equal(consistent.groups[0].disposition,'READY');const conflict=await planRosaPriceExceptions(db(),parsed(row(2),row(3,{Customer:'Different Customer','Reviewed At':'2026-09-26T00:00:00+00:00'})),'rosa.csv');assert.equal(conflict.groups[0].disposition,'REVIEW REQUIRED');assert.deepEqual(conflict.groups[0].conflictingFields,['Reviewed At','Customer']);assert.match(conflict.groups[0].messages.join(' '),/source lines: 2=/);assert.equal(conflict.groups[0].tiers.length,2)});
test('identical grouped re-import is no change; changed tiers require review without appending or overwriting',async()=>{const input=parsed(row(2,{Quantity:'100'}),row(3,{Quantity:'250'})),client=db();const firstPlan=await planRosaPriceExceptions(client,input,'rosa.csv');await applyRosaPriceExceptions(client,input,'rosa.csv',firstPlan.digest,true,91);const repeat=await planRosaPriceExceptions(client,input,'rosa.csv');assert.equal(repeat.groups[0].disposition,'EXISTING / NO CHANGE');assert.equal(repeat.counts['EXISTING / NO CHANGE'],1);await assert.rejects(applyRosaPriceExceptions(client,input,'rosa.csv',repeat.digest,true,91),/No Price Exceptions ready to import/);const changed=parsed(row(2,{Quantity:'100'}),row(3,{Quantity:'250','Approved Price':'165.00'}));const conflict=await planRosaPriceExceptions(client,changed,'rosa.csv');assert.equal(conflict.groups[0].disposition,'REVIEW REQUIRED');assert.deepEqual(conflict.groups[0].changedFields,['Pricing tiers']);assert.equal(client.writes.length,1);assert.equal(client.writes[0].lines.create.length,2)});
test('existing PE from another source requires review even if the number matches',async()=>{const existing=[{id:7,peCode:first.values['PE Number'],sourceType:'LEGACY_WORKBOOK',sourceKey:'OLD',sourceMetadata:null,lines:[]}];const plan=await planRosaPriceExceptions(db({existing}),parsed(row(2)),'rosa.csv');assert.equal(plan.groups[0].disposition,'REVIEW REQUIRED');assert.equal(plan.groups[0].existingId,7)});
test('supplied CSV has 19 groups; conflicting repeats and invalid 3027 dates remain blocked',async()=>{const accounts=[...new Set(sourceRows.flatMap(row=>[row.values.Customer,row.values.VAR,row.values['End User']]))].map((name,index)=>({id:index+100,name,status:'ACTIVE',archivedAt:null})),skus=[...new Set(sourceRows.map(row=>row.values.SKU.toUpperCase()))].map((partNumber,index)=>({id:index+100,partNumber,normalizedPartNumber:partNumber,active:true,product:{active:true,archivedAt:null}}));const plan=await planRosaPriceExceptions(db({accounts,skus}),parseRosaCsv(fixture),'price-exceptions-2026-09-25.csv');assert.equal(plan.sourceRowCount,22);assert.equal(plan.groups.length,19);for(const code of ['SPAZ09032026-2','SPAZ09032026','SPR09022026-2']){const group=plan.groups.find(item=>item.peNumber===code);assert.equal(group.disposition,'REVIEW REQUIRED');assert.ok(group.conflictingFields.length>0)}for(const code of ['SPAZ09042026LA','SPAZ08262026-2'])assert.equal(plan.groups.find(item=>item.peNumber===code).disposition,'ERROR')});
test('invalid expiration and unresolved mandatory SKU are errors; unresolved parties need review',async()=>{const wrongDate=await planRosaPriceExceptions(db(),parsed(row(2,{'Expiration Date':'3027-06-30'})),'rosa.csv');assert.equal(wrongDate.groups[0].disposition,'ERROR');const badSecond=await planRosaPriceExceptions(db(),parsed(row(2),row(3,{'Expiration Date':'3027-06-30'})),'rosa.csv');assert.equal(badSecond.groups[0].disposition,'ERROR');for(const [change,message,disposition] of [[{users:[]},'Requested By','REVIEW REQUIRED'],[{users:[...seed.users,{...seed.users[0],id:99,lastName:'Other'}]},'Requested By','REVIEW REQUIRED'],[{accounts:[]},'Customer','REVIEW REQUIRED'],[{skus:[]},'SKU','ERROR']]){const plan=await planRosaPriceExceptions(db(change),parsed(row(2)),'rosa.csv');assert.equal(plan.groups[0].disposition,disposition);assert.ok(plan.groups[0].messages.some(text=>text.includes(message)))}});
test('apply requires preview digest and explicit confirmation',async()=>{const client=db(),input=parsed(row(2)),plan=await planRosaPriceExceptions(client,input,'rosa.csv');await assert.rejects(applyRosaPriceExceptions(client,input,'rosa.csv',plan.digest,false,91),/confirmation/);await assert.rejects(applyRosaPriceExceptions(client,input,'rosa.csv','wrong',true,91),/Preview changed/);assert.equal(client.writes.length,0)});

test('unresolved Customer, VAR, and End User can each be mapped to active Accounts without changing source names',async()=>{
  for(const [field,column] of [['Customer','distributorAccountId'],['VAR','varAccountId'],['End User','endUserAccountId']]){
    const client=db({accounts:seed.accounts.filter(account=>account.name!==first.values[field])});
    const selectedId=client.source.accounts[0].id;
    const input=parsed(row(2)),initial=await planRosaPriceExceptions(client,input,'rosa.csv');
    assert.equal(initial.counts['REVIEW REQUIRED'],1);
    const choices={[initial.groups[0].groupKey]:{accountIds:{[field]:selectedId}}};
    const reviewed=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
    assert.equal(reviewed.counts.READY,1);
    assert.equal(reviewed.counts['REVIEW REQUIRED'],0);
    assert.equal(reviewed.groups[0][field==='Customer'?'customer':field==='VAR'?'varAccount':'endUser'].source,first.values[field]);
    await applyRosaPriceExceptions(client,input,'rosa.csv',reviewed.digest,true,91,choices);
    assert.equal(client.writes[0][column],selectedId);
    assert.equal(client.writes[0].sourceMetadata.rosaRawRows[0].values[field],first.values[field]);
    assert.equal(client.writes[0].sourceMetadata.rosaReviewedChoices.accountIds[field],selectedId);
    assert.equal(client.writes.length,1);
  }
});

test('unresolved Requested By and Reviewed By can be mapped to active CRM users',async()=>{
  const client=db({users:[seed.users[1]]}),input=parsed(row(2));
  const initial=await planRosaPriceExceptions(client,input,'rosa.csv');
  assert.equal(initial.counts['REVIEW REQUIRED'],1);
  const choices={[initial.groups[0].groupKey]:{userIds:{'Requested By':2,'Reviewed By':2}}};
  const reviewed=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
  assert.equal(reviewed.counts.READY,1);
  assert.equal(reviewed.groups[0].requestedBy.source,first.values['Requested By']);
  assert.equal(reviewed.groups[0].reviewedBy.source,first.values['Reviewed By']);
  await applyRosaPriceExceptions(client,input,'rosa.csv',reviewed.digest,true,91,choices);
  assert.equal(client.writes[0].assignedSalesRepUserId,2);
  assert.equal(client.writes[0].sourceSalesRepName,first.values['Requested By']);
  assert.equal(client.writes[0].sourceMetadata.reviewedByUserId,2);
  assert.equal(client.writes[0].sourceMetadata.rosaRawRows[0].values['Reviewed By'],first.values['Reviewed By']);
});

test('unresolved required SKU can be mapped without creating a SKU and updates Error to Ready',async()=>{
  const client=db(),input=parsed(row(2,{SKU:'UNKNOWN-SKU'}));
  const initial=await planRosaPriceExceptions(client,input,'rosa.csv');
  assert.equal(initial.counts.ERROR,1);
  const choices={[initial.groups[0].groupKey]:{skuIds:{2:21}}};
  const reviewed=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
  assert.equal(reviewed.counts.ERROR,0);
  assert.equal(reviewed.counts.READY,1);
  await applyRosaPriceExceptions(client,input,'rosa.csv',reviewed.digest,true,91,choices);
  assert.equal(client.writes[0].lines.create[0].productSkuId,21);
  assert.equal(client.writes[0].lines.create[0].sourceSku,'UNKNOWN-SKU');
  assert.equal(client.writes[0].lines.create[0].sourceMetadata.rosaRaw.SKU,'UNKNOWN-SKU');
});

test('resolving a SKU leaves the group in Needs review when an Account is still unresolved',async()=>{
  const client=db({accounts:seed.accounts.filter(account=>account.name!==first.values.VAR)}),input=parsed(row(2,{SKU:'UNKNOWN-SKU'}));
  const initial=await planRosaPriceExceptions(client,input,'rosa.csv');
  assert.equal(initial.counts.ERROR,1);
  const choices={[initial.groups[0].groupKey]:{skuIds:{2:21}}};
  const reviewed=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
  assert.deepEqual([reviewed.counts.ERROR,reviewed.counts['REVIEW REQUIRED'],reviewed.counts.READY],[0,1,0]);
  assert.equal(reviewed.groups[0].varAccount.issue,'No CRM match.');
  assert.equal(client.writes.length,0);
});

test('conflicting grouped header values can be chosen while every original source row is preserved',async()=>{
  const client=db(),input=parsed(row(2),row(3,{Description:'Corrected description','Reviewed At':'2026-09-26T00:00:00+00:00','End User':'Bluestar',Quantity:'250'}));
  const initial=await planRosaPriceExceptions(client,input,'rosa.csv');
  assert.deepEqual(initial.groups[0].conflictingFields,['Reviewed At','End User','Description']);
  assert.equal(initial.counts['REVIEW REQUIRED'],1);
  const choices={[initial.groups[0].groupKey]:{headerLines:{'Reviewed At':3,'End User':3,Description:3}}};
  const reviewed=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
  assert.deepEqual(reviewed.groups[0].conflictingFields,[]);
  assert.equal(reviewed.counts.READY,1);
  assert.equal(reviewed.groups[0].description,'Corrected description');
  await applyRosaPriceExceptions(client,input,'rosa.csv',reviewed.digest,true,91,choices);
  assert.equal(client.writes[0].sourceDescription,'Corrected description');
  assert.equal(client.writes[0].sourceMetadata.reviewedAt,'2026-09-26T00:00:00+00:00');
  assert.deepEqual(client.writes[0].sourceMetadata.rosaRawRows.map(item=>item.values.Description),[first.values.Description,'Corrected description']);
  assert.equal(client.writes[0].lines.create.length,2);
});

test('apply binds manual choices and source content to the reviewed digest',async()=>{
  const client=db(),input=parsed(row(2,{SKU:'UNKNOWN-SKU'})),initial=await planRosaPriceExceptions(client,input,'rosa.csv');
  const choices={[initial.groups[0].groupKey]:{skuIds:{2:21}}};
  const reviewed=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
  await assert.rejects(applyRosaPriceExceptions(client,input,'rosa.csv',reviewed.digest,true,91,{}),/Preview changed/);
  await assert.rejects(applyRosaPriceExceptions(client,parsed(row(2,{SKU:'CHANGED-SKU'})),'rosa.csv',reviewed.digest,true,91,choices),/Preview changed/);
  await assert.rejects(applyRosaPriceExceptions(client,input,'rosa.csv',reviewed.digest,false,91,choices),/confirmation/);
  assert.equal(client.writes.length,0);
  await applyRosaPriceExceptions(client,input,'rosa.csv',reviewed.digest,true,91,choices);
  const repeated=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
  assert.equal(repeated.counts['EXISTING / NO CHANGE'],1);
  await assert.rejects(applyRosaPriceExceptions(client,input,'rosa.csv',repeated.digest,true,91,choices),/No Price Exceptions ready/);
  assert.equal(client.writes.length,1);
});

test('manual choices cannot bypass invalid dates or select inactive and unreviewed records',async()=>{
  const client=db(),input=parsed(row(2,{'Expiration Date':'3027-06-30',SKU:'UNKNOWN-SKU'}));
  const initial=await planRosaPriceExceptions(client,input,'rosa.csv');
  const choices={[initial.groups[0].groupKey]:{skuIds:{2:21}}};
  const reviewed=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
  assert.equal(reviewed.counts.ERROR,1);
  await assert.rejects(applyRosaPriceExceptions(client,input,'rosa.csv',reviewed.digest,true,91,choices),/No Price Exceptions ready/);
  await assert.rejects(planRosaPriceExceptions(client,input,'rosa.csv',{[initial.groups[0].groupKey]:{headerLines:{'Expiration Date':2}}}),/Invalid header choice/);
  const invalidTimestamp=parsed(row(2),row(3,{'Reviewed At':'3027-06-30T00:00:00+00:00',Quantity:'250'}));
  const timestampPlan=await planRosaPriceExceptions(client,invalidTimestamp,'rosa.csv');
  assert.equal(timestampPlan.counts.ERROR,1);
  assert.ok(!timestampPlan.groups[0].conflictOptions.some(option=>option.field==='Reviewed At'));
  await assert.rejects(planRosaPriceExceptions(client,invalidTimestamp,'rosa.csv',{[timestampPlan.groups[0].groupKey]:{headerLines:{'Reviewed At':2}}}),/not safe for this source conflict/);
  await assert.rejects(planRosaPriceExceptions(db({skus:[{...seed.skus[1],active:false}]}),input,'rosa.csv',choices),/no longer an active CRM choice/);
  assert.equal(client.writes.length,0);
});
