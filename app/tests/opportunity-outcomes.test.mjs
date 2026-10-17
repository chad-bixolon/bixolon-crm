import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { resolveOpportunityOutcome: resolve, parseActualCloseDate: date, outcomeHistoryValue, outcomeHistoryText } = require('../lib/opportunity-outcomes.ts');
const { opportunityWhere, parseOpportunity, saveOpportunity } = require('../lib/opportunities.ts');
const { businessToday } = require('../lib/price-exception-dates.ts');
const { saveOutcomeReason, parseOutcomeReason } = require('../lib/outcome-reasons.ts');
const { saveStage } = require('../lib/sales-stage-admin.ts');
const { resolveUserContext } = require('../lib/dev-impersonation.ts');
const open = { isClosed: false, isWon: false }, won = { isClosed: true, isWon: true }, lost = { isClosed: true, isWon: false };
const reason = isWon => ({ id: isWon ? 1 : 2, name: isWon ? 'Expansion' : 'Price', active: true, isWon });
const input = isWon => ({ actualCloseDate: date('2026-10-15'), outcomeReasonId: reason(isWon).id, outcomeNotes: null });
const actor = role => ({ id: 7, role, active: true, archivedAt: null });

for (const [name, stage] of [['Won',won],['Lost',lost]]) test(`open → Closed ${name} requires date and matching active reason, notes optional`, () => {
  const value = input(stage.isWon), selected = reason(stage.isWon);
  assert.equal(resolve(stage, value, { stage: open }, selected).outcomeReasonName, selected.name);
  assert.equal(resolve(stage, { ...value, outcomeNotes: 'Short context\nAnother line' }, { stage: open }, selected).outcomeNotes, 'Short context\nAnother line');
  assert.throws(() => resolve(stage, { ...value, actualCloseDate: null }, { stage: open }, selected), /Actual Close Date/);
  assert.throws(() => resolve(stage, { ...value, outcomeReasonId: null }, { stage: open }, null), /Outcome Reason/);
  assert.throws(() => resolve(stage, value, { stage: open }, reason(!stage.isWon)), /Outcome Reason/);
  assert.throws(() => resolve(stage, value, { stage: open }, { ...selected, active: false }), /active/);
  assert.throws(() => resolve(stage, { ...value, outcomeNotes: 'a'.repeat(2001) }, { stage: open }, selected), /2000/);
});

test('reopening clears all current values; immutable prior context survives and re-close needs new values', () => {
  const closed = { ...resolve(won, input(true), { stage: open }, reason(true)), outcomeNotes: 'Expanded to 40 sites', stage: won };
  const before = outcomeHistoryValue(closed, won);
  const reopened = resolve(open, closed, closed, reason(true));
  assert.deepEqual(reopened, { actualCloseDate: null, outcomeReasonId: null, outcomeReasonName: null, outcomeNotes: null });
  assert.equal(before.outcomeNotes, 'Expanded to 40 sites'); assert.equal(before.actualCloseDate, '2026-10-15');
  assert.throws(() => resolve(lost, reopened, { ...reopened, stage: open }, null), /Actual Close Date/);
  const reclosed = resolve(lost, input(false), { ...reopened, stage: open }, reason(false));
  assert.equal(reclosed.outcomeReasonName, 'Price'); assert.equal(before.outcomeReason, 'Expansion');
  assert.match(outcomeHistoryText(before), /Closed Won.*Actual Close Date: 2026-10-15.*Expansion.*40 sites/);
});

test('legacy unknown dates remain unknown; explicit updates require full outcome; retained deactivated labels survive rename', () => {
  const empty = { stage: lost, actualCloseDate: null, outcomeReasonId: null, outcomeReasonName: null, outcomeNotes: null };
  assert.equal(resolve(lost, empty, empty, null).actualCloseDate, null);
  assert.throws(() => resolve(lost, { ...empty, outcomeNotes: 'New details' }, empty, null), /Actual Close Date/);
  const old = { ...resolve(lost, input(false), null, reason(false)), stage: lost };
  const renamed = { ...reason(false), name: 'New price label', active: false };
  assert.equal(resolve(lost, old, old, renamed).outcomeReasonName, 'Price');
  assert.equal(resolve(lost, { ...old, outcomeNotes: 'Correction' }, old, renamed).outcomeReasonName, 'Price');
  assert.throws(() => resolve(won, input(true), old, { ...reason(true), active: false }), /active/);
});

test('business-date defaults honor New York midnight and DST; parsing is date-only and rejects rollover', () => {
  for (const [instant, expected] of [['2026-10-16T02:00:00Z','2026-10-15'],['2026-03-08T04:59:59Z','2026-03-07'],['2026-03-08T05:00:00Z','2026-03-08'],['2026-11-01T04:00:00Z','2026-11-01']]) assert.equal(businessToday(new Date(instant)).toISOString().slice(0,10), expected);
  assert.equal(date('2026-10-15').toISOString(), '2026-10-15T00:00:00.000Z');
  for (const raw of ['2026-02-30','2026-13-01','0000-01-01','10/15/2026','garbage']) assert.throws(() => date(raw), /valid/);
  const f = new FormData(); f.set('actualCloseDate','2026-02-30'); f.set('outcomeNotes','a'.repeat(2001));
  const { errors } = parseOpportunity(f); assert.ok(errors.actualCloseDate); assert.ok(errors.outcomeNotes);
});

test('reusable filters combine actual-date inclusive bounds, outcome, owner and historical reason ID', () => {
  const where = opportunityWhere({ actualCloseFrom:'2026-10-01',actualCloseTo:'2026-10-31',outcomeStatus:'lost',outcomeReasonId:'2',ownerId:'7' });
  assert.deepEqual(where.stage, lost); assert.equal(where.outcomeReasonId,2); assert.equal(where.ownerId,7);
  assert.equal(where.actualCloseDate.gte.toISOString(),'2026-10-01T00:00:00.000Z'); assert.equal(where.actualCloseDate.lte.toISOString(),'2026-10-31T00:00:00.000Z');
  assert.equal(where.expectedCloseDate,undefined); assert.throws(() => opportunityWhere({actualCloseFrom:'2026-02-30'}), /valid/);
  assert.throws(() => opportunityWhere({actualCloseFrom:'2026-10-31',actualCloseTo:'2026-10-01'}), /range/);
});

test('Admin manages reason labels, active state and order; other roles and impersonated Sales cannot', async () => {
  const updates = []; const tx = { outcomeReason: { findUnique: async () => reason(true), findFirst: async () => null, update: async ({data}) => (updates.push(data),data), create: async ({data}) => data } };
  const client = { $transaction: fn => fn(tx) };
  const value = { name:'Renamed',isWon:true,active:false,sortOrder:20 };
  assert.deepEqual(await saveOutcomeReason(client,actor('ADMIN'),value,1),value);
  await assert.rejects(saveOutcomeReason(client,actor('ADMIN'),{...value,isWon:false},1), /close state/);
  for (const role of ['SALES','SALES_MANAGER','MARKETING_MANAGER','READ_ONLY','SUPPORT']) {
    await assert.rejects(saveOutcomeReason(client,actor(role),value), /Access denied/);
    if (role !== 'SALES' && role !== 'SALES_MANAGER') await assert.rejects(saveOpportunity({}, {}, 1, actor(role)), /Access denied/);
  }
  const context = await resolveUserContext({...actor('ADMIN'),name:'Admin',email:'admin@test'},'8',{user:{findUnique:async()=>({...actor('SALES'),id:8,firstName:'Sales',lastName:'Rep',email:'sales@test'})}},{NODE_ENV:'development',ENABLE_DEV_IMPERSONATION:'true'});
  await assert.rejects(saveOutcomeReason(client,context.effective,value), /Access denied/);
  const form = new FormData(); for (const [k,v] of Object.entries({name:' Test ',status:'lost',sortOrder:'10',active:'on'})) form.set(k,v);
  assert.deepEqual(parseOutcomeReason(form),{name:'Test',sortOrder:10,active:true,isWon:false});
});

test('used sales stages cannot change open/won/lost meaning and bypass outcome collection', async () => {
  const client = {$transaction:fn=>fn({salesStage:{findUnique:async()=>open},opportunity:{count:async()=>1}})};
  await assert.rejects(saveStage(client,1,{...won,name:'Won'}), /used by Opportunities/);
});
