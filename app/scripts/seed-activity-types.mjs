import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma=new PrismaClient();
const defaults=[['CALL','Call'],['EMAIL','Email'],['MEETING','Meeting'],['DEMO','Demo'],['NOTES','Notes']];
try { await prisma.$transaction(async tx=>{ await tx.$executeRaw`SELECT pg_advisory_xact_lock(726234012)`; for(const [index,[code,name]] of defaults.entries()) await tx.activityType.upsert({where:{code},update:{},create:{code,name,active:true,sortOrder:index+1}}); }); console.log('Default activity types verified.'); } finally { await prisma.$disconnect(); }
