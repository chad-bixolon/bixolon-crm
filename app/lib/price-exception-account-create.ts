import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { accountWriteData, checkAccountReferences, normalizeAccountName } from './accounts';
import { parseAccountForm } from './account-validation';
import { accountDuplicateMatches, reviewFingerprint } from './sales-readiness';

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

export async function createPeReviewAccount(client:PrismaClient, actor:Actor, form:FormData, confirmed:boolean, acknowledgeDuplicate:boolean, reviewedToken?:string) {
  if (!can(actor,'users.manage') || actor.role!=='ADMIN' || !can(actor,'accounts.write')) throw new Error('Access denied');
  const parsed=parseAccountForm(form);
  if (!parsed.value) return {kind:'validation' as const,errors:parsed.errors};
  if (parsed.value.status !== 'ACTIVE') return {kind:'validation' as const,errors:{status:'Choose Active so this Account can resolve the Price Exception.'}};
  const refs=await checkAccountReferences(client,parsed.value);
  if (Object.keys(refs).length) return {kind:'validation' as const,errors:refs};
  const candidates=await client.account.findMany({select:{id:true,name:true,status:true,archivedAt:true,website:true,addressLine1:true,postalCode:true},orderBy:{name:'asc'}});
  const exact=candidates.find(account=>normalizeAccountName(account.name)===normalizeAccountName(parsed.value!.name));
  if(exact)return {kind:'exact' as const,account:{id:exact.id,name:exact.name,usable:exact.status==='ACTIVE'&&!exact.archivedAt},message:exact.status==='ACTIVE'&&!exact.archivedAt?'An Account with this name already exists. Use the existing Account.':'An inactive or archived Account with this name exists. Reactivate it before mapping.'};
  const matches=accountDuplicateMatches(parsed.value,candidates).map(match=>({...match,usable:candidates.some(account=>account.id===match.id&&account.status==='ACTIVE'&&!account.archivedAt)}));
  const reviewToken=reviewFingerprint(parsed.value);
  if (!confirmed || reviewedToken!==undefined&&reviewedToken!==reviewToken || (matches.length>0&&!acknowledgeDuplicate)) return {kind:'review' as const,matches,reviewToken};
  return client.$transaction(async tx=>{
    const current=await tx.account.findMany({select:{id:true,name:true,status:true,archivedAt:true,website:true,addressLine1:true,postalCode:true}});
    const duplicate=current.find(account=>normalizeAccountName(account.name)===normalizeAccountName(parsed.value!.name));
    if(duplicate)return {kind:'exact' as const,account:{id:duplicate.id,name:duplicate.name,usable:duplicate.status==='ACTIVE'&&!duplicate.archivedAt},message:'An Account with this name already exists. Use the existing Account.'};
    const newMatches=accountDuplicateMatches(parsed.value!,current);
    if(newMatches.some(match=>!matches.some(prior=>prior.id===match.id)))return {kind:'review' as const,matches:newMatches.map(match=>({...match,usable:current.some(account=>account.id===match.id&&account.status==='ACTIVE'&&!account.archivedAt)})),reviewToken};
    const account=await tx.account.create({data:{...accountWriteData(parsed.value!),createdById:actor.id,updatedById:actor.id,businessRoles:{create:parsed.value!.roles.map(role=>({role}))}}});
    return {kind:'created' as const,account:{id:account.id,name:parsed.value!.name}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
