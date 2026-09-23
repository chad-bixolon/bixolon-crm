import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {AccountForm} from '@/components/account-form';
import {Content,PageHeader} from '@/components/shell';
import {prisma} from '@/lib/prisma';
import {currentUser} from '@/lib/current-user';
import {can} from '@/lib/authorization';
import {canEditTradeShowLead,tradeShowLeadReadWhere} from '@/lib/trade-shows';
import {accountOptions,findAccountNameMatches} from '@/lib/accounts';
import {getLabels} from '@/lib/configuration';

export const dynamic='force-dynamic';
const usable=(value:string|null)=>value&&!/^(?:n\/?a|none|null|-+)$/i.test(value.trim())?value.trim():null;
export default async function NewLeadAccountPage({params}:{params:Promise<{id:string;leadId:string}>}){
 const actor=await currentUser(),raw=await params,tradeShowId=Number(raw.id),leadId=Number(raw.leadId);if(!Number.isSafeInteger(tradeShowId)||!Number.isSafeInteger(leadId))notFound();
 const lead=await prisma.tradeShowLead.findFirst({where:{AND:[{id:leadId,tradeShowId},tradeShowLeadReadWhere(actor)]},include:{tradeShow:{select:{archivedAt:true}}}});if(!lead)notFound();if(!canEditTradeShowLead(actor,lead)||!can(actor,'accounts.write')||!can(actor,'trade-shows.resolve'))redirect('/access-denied');
 const [options,labels,matches]=await Promise.all([accountOptions(prisma),getLabels(prisma),lead.sourceCompany?findAccountNameMatches(prisma,lead.sourceCompany):Promise.resolve([])]);
 const initial={name:usable(lead.sourceCompany)??'',status:'ACTIVE' as const,strategicAccount:false,roles:[],industry:null,territory:null,ownerId:lead.assignedSalesRepUserId,website:usable(lead.sourceCompanyWebsite),phone:null,addressLine1:usable(lead.addressLine1),addressLine2:usable(lead.addressLine2),city:usable(lead.city),stateProvince:usable(lead.stateProvince),postalCode:usable(lead.postalCode),country:usable(lead.country)};
 return <Content><PageHeader eyebrow="Trade Show Lead" title="Review new Account" description="Source values are prefilled for review; the original Lead remains unchanged."/>{matches.length>0&&<div className="mb-5 rounded border border-amber-300 bg-amber-50 p-4"><strong>Likely existing Account{matches.length===1?'':'s'}</strong><ul className="mt-2 text-sm">{matches.map(match=><li key={match.id}><Link className="text-orange-800 underline" href={`/accounts/${match.id}`}>{match.name}</Link>{match.archivedAt?' (archived)':''}</li>)}</ul><p className="mt-2 text-sm">Return to the Lead editor to link an existing match.</p></div>}<AccountForm {...options} labels={labels} initial={initial} leadContext={{tradeShowId,leadId}}/></Content>;
}
