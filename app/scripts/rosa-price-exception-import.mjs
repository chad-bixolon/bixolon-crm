#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {parseRosaCsv,planRosaPriceExceptions,applyRosaPriceExceptions}=require(path.join(root,'lib/rosa-price-exception-import.ts'));
const [mode,file,...flags]=process.argv.slice(2);
const option=name=>{const at=flags.indexOf(name);return at>=0?flags[at+1]:null};
if(!['preview','apply'].includes(mode)||!file){console.error('Usage: node scripts/rosa-price-exception-import.mjs preview|apply FILE [--digest DIGEST --confirm IMPORT_READY_ROWS --actor-id ID]');process.exit(2)}
const source=await fs.readFile(file,'utf8');const parsed=parseRosaCsv(source);const db=new PrismaClient();
try{
  if(mode==='preview'){
    const plan=await planRosaPriceExceptions(db,parsed,path.basename(file));
    console.log(JSON.stringify(plan,null,2));
    if(plan.errors.length)process.exitCode=1;
  }else{
    const digest=option('--digest'),confirmation=option('--confirm'),actorId=Number(option('--actor-id'));
    if(!digest||confirmation!=='IMPORT_READY_ROWS'||!Number.isSafeInteger(actorId)||actorId<=0)throw new Error('Apply requires preview digest, --confirm IMPORT_READY_ROWS, and --actor-id.');
    const actor=await db.user.findUnique({where:{id:actorId},select:{role:true,active:true,archivedAt:true}});
    if(!actor||actor.role!=='ADMIN'||!actor.active||actor.archivedAt)throw new Error('Active ADMIN actor required.');
    console.log(JSON.stringify(await applyRosaPriceExceptions(db,parsed,path.basename(file),digest,true,actorId),null,2));
  }
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1}finally{await db.$disconnect()}
