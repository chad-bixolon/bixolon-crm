import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { partnerAssignmentData } = require(path.join(root,'lib/trade-show-partner-state.ts'));
const { partnerExportRow, partnerWorkbook, partnerExportHeaders, legacyPartnerExportHeaders, partnerExportFilename, awaitingPartnerWhere } = require(path.join(root,'lib/trade-show-partner-handoff.ts'));
const { can } = require(path.join(root,'lib/authorization.ts'));
const base = { routing:'REFERRED_TO_PARTNER', routedPartnerAccountId:20, status:'NEW', convertedOpportunityId:null, partnerHandoffStatus:'AWAITING_PARTNER_HANDOFF', partnerAssignmentVersion:1 };
const now = new Date('2026-10-30T12:00:00Z');
test('partner assignment starts awaiting; internal routing clears current partner state', () => {
  assert.deepEqual(partnerAssignmentData(null,base,now), { partnerHandoffStatus:'AWAITING_PARTNER_HANDOFF', partnerAssignmentVersion:1, partnerAwaitingAt:now, partnerSentAt:null });
  assert.deepEqual(partnerAssignmentData(base,{...base,routing:'BIXOLON_SALES'},now), { partnerHandoffStatus:null, partnerAwaitingAt:null, partnerSentAt:null });
  assert.deepEqual(partnerAssignmentData(base,base,now),{});
});
test('sent/awaiting reassignment starts a new assignment; same sent assignment stays sent', () => {
  for (const state of ['AWAITING_PARTNER_HANDOFF','SENT_TO_PARTNER']) {
    const before={...base,partnerHandoffStatus:state};
    const changed=partnerAssignmentData(before,{...before,routedPartnerAccountId:21},now);
    assert.equal(changed.partnerHandoffStatus,'AWAITING_PARTNER_HANDOFF'); assert.equal(changed.partnerAssignmentVersion,2); assert.equal(changed.partnerSentAt,null);
    assert.deepEqual(partnerAssignmentData(before,before,now),{});
    const back=partnerAssignmentData({...before,routing:'BIXOLON_SALES'},{...before,routing:'REFERRED_TO_PARTNER'},now);
    assert.equal(back.partnerAssignmentVersion,2);
  }
});
test('closure/conversion removes awaiting work, keeps sent history, reopening starts a new version', () => {
  for(const status of ['CONVERTED','DISQUALIFIED']) {
    assert.equal(partnerAssignmentData(base,{...base,status},now).partnerHandoffStatus,null);
    assert.deepEqual(partnerAssignmentData({...base,partnerHandoffStatus:'SENT_TO_PARTNER'},{...base,partnerHandoffStatus:'SENT_TO_PARTNER',status},now),{});
  }
  assert.equal(partnerAssignmentData({...base,status:'DISQUALIFIED',partnerHandoffStatus:null},base,now).partnerAssignmentVersion,2);
});
test('export uses an explicit external whitelist and no internal notes, identifiers or auth data', () => {
  const lead={firstName:'Ada',lastName:'Lovelace',sourceCompany:'Company',title:'Engineer',email:'ada@example.test',phone:'123',city:'City',stateProvince:'State',country:'Country',productInterest:'Printers',status:'QUALIFIED',partnerHandoffNotes:'Approved for partner',salesNotes:'SECRET SALES',referralNotes:'SECRET REFERRAL',activityNotes:'SECRET ACTIVITY',opportunityNotes:'SECRET OPPORTUNITY',auditComments:'SECRET AUDIT',historyComments:'SECRET HISTORY',pricing:'SECRET PRICING',internalStrategy:'SECRET STRATEGY',crmNotes:'SECRET CRM',sourceNotes:'Source request\nPlease discuss barcode labels',competitorSourceText:'Existing competitor',currentProductBeingUsed:'Desktop printer',customerPainPoints:'Slow label output',rawSourceData:{secret:'RAW'},id:123,password:'SECRET AUTH'};
  const row=partnerExportRow(lead,{name:'MODEX',startDate:now},'Partner','Internal Owner');
  assert.equal(row.length,20);assert.equal(row[16],'Source request\nPlease discuss barcode labels');assert.deepEqual(row.slice(17),['Existing competitor','Desktop printer','Slow label output']);assert.equal(row[13],'Approved for partner'); assert.equal(row[12],'2026-10-30');
  assert.doesNotMatch(JSON.stringify(row),/SECRET|RAW|password/);
  const book=XLSX.read(partnerWorkbook([row]),{type:'buffer'});
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['Partner Leads'],{header:1}),[partnerExportHeaders,row]);
});
test('all spreadsheet cells stay text and escape formula prefixes including whitespace/control characters', () => {
  const values=['=1+1','+SUM(A1)','-1+1','@evil',' \t=2','\n=3','\rhidden','\ttext'];
  const row=Array(partnerExportHeaders.length).fill('ordinary'); values.forEach((v,i)=>row[i]=v);
  const sheet=XLSX.read(partnerWorkbook([row]),{type:'buffer',cellFormula:true}).Sheets['Partner Leads'];
  values.forEach((v,i)=>{ const cell=sheet[XLSX.utils.encode_cell({r:1,c:i})];assert.equal(cell.t,'s');assert.equal(cell.f,undefined);assert.equal(cell.v,"'"+v); });
  assert.throws(()=>partnerWorkbook([['too few']]),/Invalid/);
});
test('default export is only current actionable unsent partner assignments', () => {
  const where=awaitingPartnerWhere(1,20);
  assert.equal(where.partnerHandoffStatus,'AWAITING_PARTNER_HANDOFF');assert.equal(where.routing,'REFERRED_TO_PARTNER');assert.equal(where.routedPartnerAccountId,20);assert.equal(where.convertedOpportunityId,null);assert.deepEqual(where.status.in,['NEW','CONTACTED','QUALIFIED']);
});
test('centralized handoff capability grants only authorized managers', () => {
  for (const role of ['ADMIN','SALES_MANAGER','MARKETING_MANAGER']) assert.equal(can({id:1,role,active:true},'trade-shows.partner-handoff'),true);
  for (const role of ['READ_ONLY','SALES','EXECUTIVE','SUPPORT','SUPPORT_MANAGER']) assert.equal(can({id:1,role,active:true},'trade-shows.partner-handoff'),false);
  assert.equal(can({id:1,role:'ADMIN',active:false},'trade-shows.partner-handoff'),false);
});

test('external filenames contain safe business labels and no internal identifiers', () => {
  const filename=partnerExportFilename('Event / "unsafe"', '../Partner\r\n', now);
  assert.match(filename,/^SalesHub_Event_unsafe_Partner_Leads_20261030120000000_[a-f0-9]{8}\.xlsx$/);
  assert.ok(partnerExportFilename('x'.repeat(1000),'y'.repeat(1000),now).length<180);
});


test('partner-shareable notes preserve multiline text, escape formula injection, and leave blank cells well formed', () => {
  const source={firstName:'Ada',lastName:'Lovelace',sourceNotes:'First line\nSecond line',partnerHandoffNotes:'Partner referral\r\nPlease call',productInterest:'Label printers',status:'QUALIFIED',competitorSourceText:null,currentProductBeingUsed:null,customerPainPoints:null};
  const row=partnerExportRow(source,{name:'Show',startDate:null},'Partner','Owner');
  const read=values=>XLSX.utils.sheet_to_json(XLSX.read(partnerWorkbook([values]),{type:'buffer'}).Sheets['Partner Leads'],{header:1,defval:''});
  assert.equal(read(row)[1][16],source.sourceNotes);assert.equal(row[13],source.partnerHandoffNotes);
  // Excel XML readers normalize Windows line endings while retaining the line break.
  assert.equal(read(row)[1][13],source.partnerHandoffNotes.replace(/\r\n/g,'\n'));
  for(const value of ['=HYPERLINK("https://example.test")','+SUM(A1:A2)','-2+1','@command',' \t=1','\n=2']) {
    for(const field of ['sourceNotes','partnerHandoffNotes','productInterest','customerPainPoints','competitorSourceText','currentProductBeingUsed']) {
      const values=partnerExportRow({...source,[field]:value},{name:'Show',startDate:null},'Partner','Owner');
      const sheet=XLSX.read(partnerWorkbook([values]),{type:'buffer',cellFormula:true}).Sheets['Partner Leads'];
      const index={sourceNotes:16,partnerHandoffNotes:13,productInterest:9,competitorSourceText:17,currentProductBeingUsed:18,customerPainPoints:19}[field];
      const cell=sheet[XLSX.utils.encode_cell({r:1,c:index})];
      assert.equal(cell.v,"'"+value);assert.equal(cell.t,'s');assert.equal(cell.f,undefined);
    }
  }
  const blank=partnerExportRow({...source,sourceNotes:null,partnerHandoffNotes:'',productInterest:null,customerPainPoints:null},{name:'Show',startDate:null},'Partner','Owner');
  const exported=read(blank);assert.equal(exported[0].length,20);assert.equal(exported[1].length,20);assert.equal(exported[1][16],'');assert.equal(exported[1][13],'');
});

test('historical export retains original columns and rejects mixed or unsupported snapshot widths', () => {
  const row=Array(16).fill('Original shared value');
  const sheet=XLSX.read(partnerWorkbook([row]),{type:'buffer'}).Sheets['Partner Leads'];
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet,{header:1}),[legacyPartnerExportHeaders,row]);
  assert.ok(!legacyPartnerExportHeaders.includes('Source Notes'));
  assert.throws(()=>partnerWorkbook([row,Array(20).fill('New context')]),/Invalid partner export snapshot/);
  assert.throws(()=>partnerWorkbook([Array(17).fill('Invalid')]),/Invalid partner export snapshot/);
});
