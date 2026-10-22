import { fixtureEnv, productionEnv, installConnectionDb } from './support-gmail-test-helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const credentials = installConnectionDb();
const gmail = require(path.join(root, 'lib/support-gmail.ts'));
const connection = require(path.join(root, 'lib/support-gmail-connection.ts'));
const config = require(path.join(root, 'lib/support-gmail-config.ts'));
const keys = ['SUPPORT_GMAIL_ENABLED','SUPPORT_GMAIL_MOCK','SUPPORT_GMAIL_TEST_FIXTURE','SUPPORT_GMAIL_CLIENT_ID','SUPPORT_GMAIL_CLIENT_SECRET','SUPPORT_GMAIL_MAILBOX','SUPPORT_GMAIL_ENCRYPTION_KEY','SUPPORT_GMAIL_OAUTH_CALLBACK_URL','SUPPORT_GMAIL_EXPECTED_DATABASE_IDENTITY','SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS','SUPPORT_GMAIL_LIVE_DRY_RUN','SUPPORT_POC_LOCAL_AUTH_ENABLED','E2E_AUTH_ENABLED','E2E_AUTH_TOKEN','AUTH_URL','AUTH_SECRET','DATABASE_URL','NODE_ENV'];
let original;
test.beforeEach(()=>{
  original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  credentials.reset();
  Object.assign(process.env, productionEnv());
});
test.afterEach(()=>{for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;});
const actor=(role='ADMIN',id=5)=>({id,role,active:true});
const input=flow=>({actor:actor(),state:flow.state,cookie:flow.state,verifier:flow.verifier,code:'code',error:null});

test('dedicated client, exact read-only scope, callback, mailbox hint and S256 PKCE',()=>{
  const flow=connection.beginSupportGmailAuthorization(5),url=new URL(flow.url);
  for(const [key,value] of Object.entries({client_id:'dedicated-client',redirect_uri:config.supportGmailCallback(),scope:config.SUPPORT_GMAIL_SCOPE,login_hint:'support@example.test',access_type:'offline',code_challenge_method:'S256'}))assert.equal(url.searchParams.get(key),value);
  assert.equal(url.searchParams.get('code_challenge'),crypto.createHash('sha256').update(flow.verifier).digest('base64url'));
  assert.equal(url.searchParams.has('include_granted_scopes'),false);
  assert.deepEqual(connection.supportGmailCookieOptions(),{httpOnly:true,sameSite:'lax',secure:true,path:'/api/support-gmail/callback',maxAge:600});
});

test('state expiry, future time, wrong user, tampering, cookie/verifier mismatch and replay',()=>{
  const now=Date.now(),verifier=crypto.randomBytes(32).toString('base64url'),state=connection.makeSupportGmailState(5,now,verifier);
  for(const [value,cookie,id,at] of [[null,state,5,now],[state,undefined,5,now],[state,'other',5,now],[state,state,6,now],[state,state,5,now+600000],[state,state,5,now-1],[state.replace(/^5/,'6'),state.replace(/^5/,'6'),6,now]])assert.equal(connection.validSupportGmailState(value,cookie,id,at),false);
  assert.equal(connection.consumeSupportGmailState(state,state,5,'x'.repeat(43),now),false);
  assert.equal(connection.consumeSupportGmailState(state,state,5,verifier,now),true);
  assert.equal(connection.consumeSupportGmailState(state,state,5,verifier,now),false);
});

test('callback success, denied roles, decline, missing code, wrong mailbox and failures save only on success',async()=>{
  let saves=0,exchanges=0;
  const deps={exchange:async()=>{exchanges++;return {accessToken:'access',refreshToken:'refresh'}},profile:async()=> 'support@example.test',save:async()=>{saves++;}};
  const request=input(connection.beginSupportGmailAuthorization(5));
  for(const user of [actor('SUPPORT'),actor('SUPPORT_MANAGER'),actor('SALES'),null,{...actor(),active:false}])assert.equal(await connection.completeSupportGmailAuthorization({...request,actor:user},deps),'invalid-state');
  assert.equal(await connection.completeSupportGmailAuthorization(request,deps),'connected');
  assert.equal(await connection.completeSupportGmailAuthorization(request,deps),'invalid-state');
  assert.equal(exchanges,1);assert.equal(saves,1);
  assert.equal(await connection.completeSupportGmailAuthorization({...input(connection.beginSupportGmailAuthorization(5)),error:'access_denied'},deps),'declined');
  assert.equal(await connection.completeSupportGmailAuthorization({...input(connection.beginSupportGmailAuthorization(5)),code:null},deps),'failed');
  assert.equal(await connection.completeSupportGmailAuthorization(input(connection.beginSupportGmailAuthorization(5)),{...deps,profile:async()=> 'personal@example.test'}),'failed');
  assert.equal(await connection.completeSupportGmailAuthorization(input(connection.beginSupportGmailAuthorization(5)),{...deps,exchange:async()=>{throw new Error('private provider payload');}}),'failed');
  assert.equal(saves,1);
});

function captureDiagnostics(t) {
  const logs=[];
  for(const method of ['error','warn','log'])t.mock.method(console,method,(...args)=>logs.push({method,args}));
  return logs;
}
function diagnosticFixture() {
  const request={...input(connection.beginSupportGmailAuthorization(5)),code:'private-diagnostic-authorization-code'};
  const token={accessToken:'private-diagnostic-access-token',refreshToken:'private-diagnostic-refresh-token'};
  const secrets=[request.code,token.accessToken,token.refreshToken,process.env.SUPPORT_GMAIL_CLIENT_SECRET,process.env.SUPPORT_GMAIL_ENCRYPTION_KEY,process.env.AUTH_SECRET,request.state,request.cookie,request.verifier];
  const url=`${config.supportGmailCallback()}?code=${request.code}&state=${request.state}`;
  const cookies=`${connection.SUPPORT_GMAIL_STATE_COOKIE}=${request.cookie}; ${connection.SUPPORT_GMAIL_VERIFIER_COOKIE}=${request.verifier}`;
  const payload=[...secrets,url,cookies,'private-diagnostic-provider-response'].join('\n');
  const error=new Error(payload,{cause:{url,cookies,token}});
  error.name=payload;
  error.stack=payload;
  // Logging must not inspect, serialize or stringify a caught error.
  error.toString=()=>{throw new Error('OAuth error must not be inspected');};
  return {request,token,secrets:[...secrets,url,cookies,'private-diagnostic-provider-response'],error};
}
function assertDiagnostic(logs,stage,secrets) {
  assert.deepEqual(logs,[{method:'error',args:[`[Support Gmail] OAuth callback failed at stage: ${stage}`]}]);
  const output=JSON.stringify(logs);
  for(const secret of secrets)assert.equal(output.includes(secret),false);
}

test('callback configuration diagnostics fail before external work and contain only the stage',async t=>{
  const logs=captureDiagnostics(t);
  let calls=0;
  const unexpected=async()=>{calls++;throw new Error('Configuration must fail before external work');};
  const deps={exchange:unexpected,profile:unexpected,save:unexpected};
  for(const [key,value] of [
    ['SUPPORT_GMAIL_ENABLED','false'],['AUTH_URL','http://localhost:3000'],
    ['DATABASE_URL','postgresql://wrong:private-db-password@db:5432/wrong'],['NODE_ENV','development'],
    ['SUPPORT_GMAIL_MOCK','true'],['SUPPORT_GMAIL_TEST_FIXTURE','true'],
    ['SUPPORT_GMAIL_CLIENT_ID',''],['SUPPORT_GMAIL_CLIENT_SECRET',''],
    ['SUPPORT_GMAIL_OAUTH_CALLBACK_URL','http://localhost:3001/callback?code=private-config-code'],
    ['SUPPORT_GMAIL_ENCRYPTION_KEY','private-invalid-encryption-key'],['AUTH_SECRET',''],
    ['SUPPORT_GMAIL_MAILBOX','private-invalid-mailbox'],
  ]){
    const fixture=diagnosticFixture(),previous=process.env[key];
    process.env[key]=value;
    try{
      logs.length=0;
      assert.equal(await connection.completeSupportGmailAuthorization(fixture.request,deps),'failed');
      assertDiagnostic(logs,'environment/config validation',[...fixture.secrets,...(value?[value]:[])]);
      assert.equal(calls,0);
    }finally{process.env[key]=previous;}
  }
});

test('callback exceptions at each stage never log secret-bearing errors or callback input',async t=>{
  const logs=captureDiagnostics(t);
  for(const stage of ['OAuth state/PKCE validation','token exchange','Gmail profile lookup','expected mailbox validation','encrypted credential save']){
    const fixture=diagnosticFixture(),calls=[];
    const deps={
      exchange:async()=>{calls.push('token exchange');if(stage==='token exchange')throw fixture.error;return fixture.token;},
      profile:async()=>{calls.push('Gmail profile lookup');if(stage==='Gmail profile lookup')throw fixture.error;return stage==='expected mailbox validation'?'private-personal-mailbox@example.test':'support@example.test';},
      save:async()=>{calls.push('encrypted credential save');if(stage==='encrypted credential save')throw fixture.error;},
    };
    if(stage==='OAuth state/PKCE validation')Object.defineProperty(fixture.request,'state',{get(){throw fixture.error;}});
    logs.length=0;
    assert.equal(await connection.completeSupportGmailAuthorization(fixture.request,deps),'failed');
    assertDiagnostic(logs,stage,[...fixture.secrets,'private-personal-mailbox@example.test']);
    assert.deepEqual(calls,{
      'OAuth state/PKCE validation':[],
      'token exchange':['token exchange'],
      'Gmail profile lookup':['token exchange','Gmail profile lookup'],
      'expected mailbox validation':['token exchange','Gmail profile lookup'],
      'encrypted credential save':['token exchange','Gmail profile lookup','encrypted credential save'],
    }[stage]);
  }
});

test('callback rejected state/PKCE and missing code get safe diagnostics; success and decline stay quiet',async t=>{
  const logs=captureDiagnostics(t);
  let exchanges=0,saves=0;
  const deps={exchange:async()=>{exchanges++;return {accessToken:'access',refreshToken:'refresh'};},profile:async()=> 'support@example.test',save:async()=>{saves++;}};
  for(const change of [{actor:null},{cookie:'private-wrong-cookie'},{verifier:'x'.repeat(43)},{state:'private-invalid-state'},{verifier:undefined}]){
    const fixture=diagnosticFixture();logs.length=0;
    assert.equal(await connection.completeSupportGmailAuthorization({...fixture.request,...change},deps),'invalid-state');
    assertDiagnostic(logs,'OAuth state/PKCE validation',[...fixture.secrets,'private-wrong-cookie','private-invalid-state','x'.repeat(43)]);
  }
  assert.equal(exchanges,0);assert.equal(saves,0);
  const fixture=diagnosticFixture();logs.length=0;
  assert.equal(await connection.completeSupportGmailAuthorization({...fixture.request,code:null},deps),'failed');
  assertDiagnostic(logs,'token exchange',fixture.secrets);
  logs.length=0;
  assert.equal(await connection.completeSupportGmailAuthorization({...diagnosticFixture().request,error:'private-provider-error?code=private-code'},deps),'declined');
  assert.deepEqual(logs,[]);
  const success=diagnosticFixture();
  assert.equal(await connection.completeSupportGmailAuthorization(success.request,deps),'connected');
  assert.deepEqual(logs,[]);
  assert.equal(await connection.completeSupportGmailAuthorization(success.request,deps),'invalid-state');
  assertDiagnostic(logs,'OAuth state/PKCE validation',success.secrets);
  assert.equal(exchanges,1);assert.equal(saves,1);
});

test('real callback provider and PostgreSQL failures produce safe stage diagnostics', async t => {
  const logs = captureDiagnostics(t);
  let fixture, scenario;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/token')) {
      if (scenario === 'token') throw fixture.error;
      return new Response(JSON.stringify({access_token: fixture.token.accessToken, refresh_token: fixture.token.refreshToken, scope: config.SUPPORT_GMAIL_SCOPE, token_type: 'Bearer'}));
    }
    if (scenario === 'profile') throw fixture.error;
    return new Response(JSON.stringify({emailAddress: scenario === 'mailbox' ? 'personal@example.test' : 'support@example.test'}));
  });
  t.mock.method(credentials.db.supportGmailConnection, 'upsert', async () => {throw fixture.error;});
  for (const [name, stage] of [['token','token exchange'], ['profile','Gmail profile lookup'], ['mailbox','expected mailbox validation'], ['save','encrypted credential save']]) {
    scenario = name; fixture = diagnosticFixture(); logs.length = 0;
    assert.equal(await connection.completeSupportGmailAuthorization(fixture.request), 'failed');
    assertDiagnostic(logs, stage, fixture.secrets);
  }
});

test('token exchange sends verifier and rejects broader/missing scope, bearer and offline credentials',async()=>{
  const verifier=crypto.randomBytes(32).toString('base64url'),token={access_token:'access',refresh_token:'refresh',token_type:'Bearer',scope:config.SUPPORT_GMAIL_SCOPE};
  let request;
  assert.deepEqual(await connection.exchangeSupportGmailCode('code',verifier,async(url,init)=>{request={url,init};return new Response(JSON.stringify(token));}),{accessToken:'access',refreshToken:'refresh'});
  assert.equal(request.init.body.get('code_verifier'),verifier);assert.equal(request.init.body.get('client_id'),'dedicated-client');assert.equal(request.init.cache,'no-store');assert.ok(request.init.signal);
  for(const scope of [undefined,'https://mail.google.com/',`${config.SUPPORT_GMAIL_SCOPE} https://www.googleapis.com/auth/gmail.modify`,`${config.SUPPORT_GMAIL_SCOPE} openid`,'https://www.googleapis.com/auth/gmail.send'])await assert.rejects(connection.exchangeSupportGmailCode('code',verifier,async()=>new Response(JSON.stringify({...token,scope}))),/only gmail.readonly/);
  for(const change of [{access_token:undefined},{refresh_token:undefined},{token_type:'MAC'}])await assert.rejects(connection.exchangeSupportGmailCode('code',verifier,async()=>new Response(JSON.stringify({...token,...change}))),/offline read-only/);
  await assert.rejects(connection.exchangeSupportGmailCode('code',verifier,async()=>new Response('private provider response',{status:400})),/OAuth exchange failed/);
  await assert.rejects(connection.exchangeSupportGmailCode('code',verifier,async()=>{throw new Error('private network error');}),/could not reach Google/);
});

test('PostgreSQL encrypted token persistence, reconnect/disconnect, tamper resistance and safe metadata', async () => {
  await connection.saveSupportGmailConnection('support@example.test', 'private-refresh', actor());
  assert.equal(credentials.record.connectedByUserId, 5);
  assert.equal(credentials.record.grantedScope, config.SUPPORT_GMAIL_SCOPE);
  const first = credentials.record.refreshTokenEncrypted;
  assert.doesNotMatch(first, /private-refresh/);
  assert.equal((await connection.connectedRefreshToken()).refreshToken, 'private-refresh');
  assert.doesNotMatch(JSON.stringify(await connection.connectionStatus()), /refreshToken|private-refresh/);
  await connection.recordSupportGmailFetch(new Date());
  assert.ok((await connection.connectionStatus()).lastSyncedAt instanceof Date);
  await connection.saveSupportGmailConnection('support@example.test', 'reconnected', actor('ADMIN', 6));
  assert.notEqual(credentials.record.refreshTokenEncrypted, first);
  assert.equal(credentials.record.connectedByUserId, 6);
  assert.equal((await connection.connectedRefreshToken()).refreshToken, 'reconnected');
  await assert.rejects(connection.saveSupportGmailConnection('personal@example.test', 'bad', actor()), /does not match/);
  assert.equal((await connection.connectedRefreshToken()).refreshToken, 'reconnected');
  for (const role of ['READ_ONLY','SALES','MARKETING_MANAGER']) {
    await assert.rejects(connection.saveSupportGmailConnection('support@example.test','bad',actor(role)), /Access denied/);
    await assert.rejects(connection.disconnectSupportGmail(actor(role)), /Access denied/);
  }
  const key = process.env.SUPPORT_GMAIL_ENCRYPTION_KEY;
  process.env.SUPPORT_GMAIL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  await assert.rejects(connection.connectedRefreshToken(), /credential is unavailable/);
  process.env.SUPPORT_GMAIL_ENCRYPTION_KEY = key;
  const parts = credentials.record.refreshTokenEncrypted.split(':');
  const bytes = Buffer.from(parts[3], 'base64url'); bytes[0] ^= 1; parts[3] = bytes.toString('base64url');
  credentials.record.refreshTokenEncrypted = parts.join(':');
  await assert.rejects(connection.connectedRefreshToken(), /credential is unavailable/);
  await connection.disconnectSupportGmail(actor());
  assert.equal((await connection.connectionStatus()).connected, false);
  await connection.disconnectSupportGmail(actor());
  await assert.rejects(connection.connectedRefreshToken(), /Connect Support Gmail/);
});

test('production origin, callback, database, TLS and fixture boundaries fail closed', () => {
  assert.ok(gmail.supportMailbox() instanceof gmail.GoogleGmailSupportMailbox);
  assert.doesNotThrow(() => config.assertLiveSupportGmailRequest('saleshub.example.test'));
  assert.throws(() => config.assertLiveSupportGmailRequest('other.example.test'), /canonical/);
  for (const [key, value] of [
    ['NODE_ENV','development'], ['AUTH_URL','http://saleshub.example.test'], ['AUTH_URL','https://saleshub.example.test/path'],
    ['AUTH_URL','https://saleshub.example.test?query=1'], ['AUTH_URL','https://user:pass@saleshub.example.test'],
    ['SUPPORT_GMAIL_OAUTH_CALLBACK_URL','https://other.example.test/api/support-gmail/callback'],
    ['DATABASE_URL','postgresql://saleshub:unit@postgres.example.test:25060/wrong?sslmode=require'],
    ['DATABASE_URL','postgresql://saleshub:unit@postgres.example.test:25060/saleshub'],
    ['SUPPORT_GMAIL_EXPECTED_DATABASE_IDENTITY','wrong'], ['SUPPORT_GMAIL_MOCK','true'], ['SUPPORT_GMAIL_TEST_FIXTURE','true'],
    ['E2E_AUTH_ENABLED','true'], ['SUPPORT_GMAIL_ENABLED','false'],
  ]) {
    const previous = process.env[key]; process.env[key] = value;
    assert.throws(() => gmail.supportMailbox(), key);
    assert.equal(connection.supportGmailClientConfigured(), false, key);
    process.env[key] = previous;
  }
  delete process.env.SUPPORT_GMAIL_OAUTH_CALLBACK_URL;
  assert.equal(config.supportGmailCallback(), 'https://saleshub.example.test/api/support-gmail/callback');
  Object.assign(process.env, fixtureEnv);
  assert.ok(gmail.supportMailbox() instanceof gmail.MockGmailSupportMailbox);
  process.env.SUPPORT_GMAIL_MOCK = 'false'; process.env.SUPPORT_GMAIL_TEST_FIXTURE = 'true';
  assert.ok(gmail.supportMailbox() instanceof gmail.MockGmailSupportMailbox);
  assert.throws(() => connection.beginSupportGmailAuthorization(5));
  process.env.DATABASE_URL = 'postgresql://wrong:unit@127.0.0.1:55432/wrong';
  assert.throws(() => gmail.supportMailbox(), /fixtures require/);
});

test('inbox distinguishes development and invalid production setup without exposing runtime values', async () => {
  assert.equal(config.supportGmailEnvironmentIssue(), null);
  process.env.NODE_ENV = 'development';
  assert.match(config.supportGmailEnvironmentIssue(), /development instance/);
  await assert.rejects(connection.connectionStatus(), /requires production/);
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'postgresql://private-user:private-password@private-host:5432/private-db';
  const issue = config.supportGmailEnvironmentIssue();
  assert.match(issue, /not configured for this environment/);
  assert.doesNotMatch(issue, /migrations|private-user|private-password|private-host|private-db/);
  await assert.rejects(connection.connectionStatus(), /database must match/);
});

test('live adapter injection reads normalized messages without any Gmail mutation',async()=>{
  try{
    await connection.saveSupportGmailConnection('support@example.test','unit-refresh',actor());const calls=[];
    const fetcher=async(url,init={})=>{
      calls.push({url:String(url),method:init.method??'GET'});let body;
      if(String(url).includes('/token'))body={access_token:'unit-access',scope:config.SUPPORT_GMAIL_SCOPE};
      else if(String(url).endsWith('/profile'))body={emailAddress:'support@example.test'};
      else if(String(url).includes('messages?'))body={messages:[{id:'one'}]};
      else body={id:'one',threadId:'thread',internalDate:String(Date.now()),snippet:'Hello',payload:{mimeType:'text/plain',body:{data:Buffer.from('Read-only body').toString('base64url')},headers:[{name:'From',value:'Customer <customer@example.test>'},{name:'Subject',value:'Printer repair'}]}};
      return new Response(JSON.stringify(body));
    };
    const { SupportGmailRuntime } = require(path.join(root,'lib/support-gmail-runtime.ts'));
    const rows=await new gmail.GoogleGmailSupportMailbox(fetcher, new SupportGmailRuntime()).recent();assert.equal(rows[0].bodyText,'');assert.equal(rows[0].senderEmail,'customer@example.test');
    assert.equal(calls.length,4);assert.equal(calls[0].method,'POST');for(const call of calls.slice(1)){assert.equal(call.method,'GET');assert.match(call.url,/users\/me\/(profile|messages)/);}
    assert.doesNotMatch(JSON.stringify(rows),/unit-access|unit-refresh/);
    await assert.rejects(new gmail.GoogleGmailSupportMailbox(async()=>new Response('private malformed token'), new SupportGmailRuntime()).recent(),/^Error: Support Gmail returned an invalid response/);
    for(const status of [401,403,429,500])await assert.rejects(new gmail.GoogleGmailSupportMailbox(async(url,init)=>String(url).includes('/token')?fetcher(url,init):new Response('',{status}), new SupportGmailRuntime()).recent(),/expired|denied|rate limited|temporarily unavailable/);
  }finally{}
});


test('authenticated encryption rejects token copying across mailbox, host, database or OAuth clients', async () => {
  const {encryptSupportGmailToken, decryptSupportGmailToken} = require(path.join(root,'lib/support-gmail-crypto.ts'));
  const encrypted = encryptSupportGmailToken('private-bound-token','support@example.test');
  assert.equal(decryptSupportGmailToken(encrypted,'support@example.test'),'private-bound-token');
  assert.throws(() => decryptSupportGmailToken(encrypted,'another@example.test'));
  for (const [key,value] of [['AUTH_URL','https://other.example.test'],['DATABASE_URL','postgresql://saleshub:unit@other-db.example.test:25060/saleshub?sslmode=require'],['SUPPORT_GMAIL_CLIENT_ID','other-client']]) {
    const previous = process.env[key]; process.env[key] = value;
    assert.throws(() => decryptSupportGmailToken(encrypted,'support@example.test'));
    process.env[key] = previous;
  }
  process.env.SUPPORT_GMAIL_ENCRYPTION_KEY = 'invalid';
  assert.throws(() => encryptSupportGmailToken('private-bound-token','support@example.test'),/32-byte key/);
});

test('both Support roles use Inbox but only Admin may administer Gmail', async () => {
  const {can,routeAccess} = require(path.join(root,'lib/authorization.ts'));
  for (const role of ['SUPPORT','SUPPORT_MANAGER','ADMIN']) {
    const who = actor(role);
    assert.equal(can(who,'support-inbox.write'),true);
    assert.equal(routeAccess('/support/inbox',who),'allowed');
    assert.equal(can(who,'support-mailbox.manage'),role==='ADMIN');
    assert.equal(routeAccess('/api/support-gmail/callback',who),role==='ADMIN'?'allowed':'denied');
    if (role !== 'ADMIN') {
      const trap = new Proxy({}, {get(){throw new Error('Unexpected credential database access');}});
      await assert.rejects(connection.disconnectSupportGmail(who,trap), /Access denied/);
      await assert.rejects(connection.saveSupportGmailConnection('support@example.test','secret',who,trap), /Access denied/);
    }
  }
});
