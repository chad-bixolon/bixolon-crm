// Real PostgreSQL round trip in the fixed disposable E2E DB; no Gmail calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { databaseUrl, emails } from '../e2e/constants.mjs';
import { productionEnv } from '../tests/support-gmail-test-helpers.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = new URL(databaseUrl);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '55432');
assert.equal(target.pathname, '/saleshub_e2e');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require = Module.createRequire(import.meta.url);
const connection = require(path.join(root, 'lib/support-gmail-connection.ts'));
const db = new PrismaClient({datasources:{db:{url:databaseUrl}}});
Object.assign(process.env, productionEnv());
globalThis.fetch = async () => {throw new Error('Network calls are prohibited in persistence verification');};
const rollback = new Error('synthetic verification rollback');
try {
  const user = await db.user.findUniqueOrThrow({where:{email:emails.support}});
  const actor = {id:user.id,role:'SUPPORT',active:true};
  await db.$transaction(async tx => {
    await connection.saveSupportGmailConnection('support@example.test','synthetic-refresh',actor,tx);
    const stored = await tx.supportGmailConnection.findUniqueOrThrow({where:{id:'support'}});
    assert.notEqual(stored.refreshTokenEncrypted,'synthetic-refresh');
    assert.equal(stored.connectedByUserId,user.id);
    assert.equal((await connection.connectedRefreshToken(tx)).refreshToken,'synthetic-refresh');
    assert.doesNotMatch(JSON.stringify(await connection.connectionStatus(tx)),/synthetic-refresh|refreshToken/);
    await connection.saveSupportGmailConnection('support@example.test','reconnected-refresh',actor,tx);
    assert.equal(await tx.supportGmailConnection.count(),1);
    assert.equal((await connection.connectedRefreshToken(tx)).refreshToken,'reconnected-refresh');
    await assert.rejects(connection.saveSupportGmailConnection('wrong@example.test','bad',actor,tx),/does not match/);
    assert.equal((await connection.connectedRefreshToken(tx)).refreshToken,'reconnected-refresh');
    await connection.disconnectSupportGmail(actor,tx);
    assert.equal((await connection.connectionStatus(tx)).connected,false);
    assert.equal(await tx.supportGmailConnection.count(),0);
    throw rollback;
  }).catch(error => {if(error !== rollback)throw error;});
  assert.equal(await db.supportGmailConnection.count(),0);
  console.log('PASS: encrypted PostgreSQL round trip, singleton reconnect, failed reconnect preservation, safe metadata, disconnect; rolled back in saleshub_e2e.');
} finally {await db.$disconnect();}
