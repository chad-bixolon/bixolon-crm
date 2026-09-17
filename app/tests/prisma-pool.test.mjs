import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {productionDatasourceUrl}=require(path.join(root,'lib/prisma-pool.ts'));

test('production pool cap preserves credentials, TLS parameters and explicit tuning',()=>{
  const input='postgresql://user:secret@example.com:25060/crm?sslmode=require&schema=public';
  const result=new URL(productionDatasourceUrl(input,'production'));
  assert.equal(result.searchParams.get('connection_limit'),'4');
  assert.equal(result.searchParams.get('sslmode'),'require');
  assert.equal(result.searchParams.get('schema'),'public');
  assert.equal(result.password,'secret');
  assert.equal(productionDatasourceUrl(input,'development'),undefined);
  assert.equal(productionDatasourceUrl(`${input}&connection_limit=2`,'production'),undefined);
});

test('production module evaluations reuse one shared Prisma client',()=>{
  const filename=path.join(root,'lib/prisma.ts');
  const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
  const oldLoad=Module._load, oldPrisma=globalThis.prisma, oldUrl=process.env.DATABASE_URL, oldEnvironment=process.env.NODE_ENV;
  let created=0, options;
  class FakePrismaClient { constructor(value) {created++;options=value;} }
  try {
    delete globalThis.prisma;
    process.env.NODE_ENV='production';
    process.env.DATABASE_URL='postgresql://user:secret@example.com:25060/crm?sslmode=require';
    Module._load=function(request,parent,isMain) { return request==='@prisma/client' ? {PrismaClient:FakePrismaClient} : oldLoad.call(this,request,parent,isMain); };
    const evaluate=()=>{ const mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(source,filename);return mod.exports.prisma; };
    assert.equal(evaluate(),evaluate());
    assert.equal(created,1);
    assert.equal(new URL(options.datasources.db.url).searchParams.get('connection_limit'),'4');
  } finally {
    Module._load=oldLoad;
    if (oldPrisma === undefined) delete globalThis.prisma; else globalThis.prisma=oldPrisma;
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=oldUrl;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=oldEnvironment;
  }
});
