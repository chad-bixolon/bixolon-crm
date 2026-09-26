import type { PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { checkAccountReferences, normalizeAccountName, saveAccount } from './accounts';
import { parseAccountForm } from './account-validation';

export const peAccountFields = ['Customer', 'VAR', 'End User'] as const;
export type PeAccountField = typeof peAccountFields[number];

export function likelyAccountMatches(accounts: {id:number;name:string}[], name:string) {
  const needle=normalizeAccountName(name);
  if (!needle) return [];
  const terms=needle.split(' ').filter(term=>term.length>2);
  return accounts.filter(account=>{
    const candidate=normalizeAccountName(account.name);
    return candidate===needle || (needle.length>=4 && (candidate.includes(needle)||needle.includes(candidate))) || (terms.length>0 && terms.every(term=>candidate.includes(term)));
  }).slice(0,10);
}

export async function createPeReviewAccount(client:PrismaClient, actor:Actor, form:FormData, confirmed:boolean, acknowledgeDuplicate:boolean) {
  if (!can(actor,'users.manage') || actor.role!=='ADMIN' || !can(actor,'accounts.write')) throw new Error('Access denied');
  const parsed=parseAccountForm(form);
  if (!parsed.value) return {kind:'validation' as const,errors:parsed.errors};
  if (parsed.value.status !== 'ACTIVE') return {kind:'validation' as const,errors:{status:'Choose Active so this Account can resolve the Price Exception.'}};
  const refs=await checkAccountReferences(client,parsed.value);
  if (Object.keys(refs).length) return {kind:'validation' as const,errors:refs};
  const candidates=await client.account.findMany({where:{archivedAt:null},select:{id:true,name:true},orderBy:{name:'asc'}});
  const matches=likelyAccountMatches(candidates,parsed.value.name);
  if (!confirmed || (matches.length>0&&!acknowledgeDuplicate)) return {kind:'review' as const,matches};
  const id=await saveAccount(client,parsed.value,undefined,actor.id);
  return {kind:'created' as const,account:{id,name:parsed.value.name}};
}
