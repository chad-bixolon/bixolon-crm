import type { PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';

function requireManager(actor:Actor){if(!can(actor,'trade-shows.manage'))throw new Error('Access denied');}
export async function renameTradeShowImportMapping(client:PrismaClient,id:number,name:string,actor:Actor){
  requireManager(actor);const clean=name.trim();if(!Number.isSafeInteger(id)||id<1||clean.length<2||clean.length>100)throw new Error('Enter a mapping name between 2 and 100 characters.');
  return client.tradeShowImportMapping.update({where:{id},data:{name:clean,updatedById:actor.id}});
}
export async function setTradeShowImportMappingArchived(client:PrismaClient,id:number,archived:boolean,actor:Actor){
  requireManager(actor);if(!Number.isSafeInteger(id)||id<1)throw new Error('Mapping not found.');
  return client.tradeShowImportMapping.update({where:{id},data:{archivedAt:archived?new Date():null,updatedById:actor.id}});
}
