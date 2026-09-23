import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {ContactForm} from '@/components/contact-form';
import {Content,PageHeader} from '@/components/shell';
import {prisma} from '@/lib/prisma';
import {currentUser} from '@/lib/current-user';
import {can} from '@/lib/authorization';
import {canEditTradeShowLead,tradeShowLeadReadWhere} from '@/lib/trade-shows';

export const dynamic='force-dynamic';
const usable=(value:string|null)=>value&&!/^(?:n\/?a|none|null|-+)$/i.test(value.trim())?value.trim():null;
export default async function NewLeadContactPage({params}:{params:Promise<{id:string;leadId:string}>}){
 const actor=await currentUser(),raw=await params,tradeShowId=Number(raw.id),leadId=Number(raw.leadId);if(!Number.isSafeInteger(tradeShowId)||!Number.isSafeInteger(leadId))notFound();
 const lead=await prisma.tradeShowLead.findFirst({where:{AND:[{id:leadId,tradeShowId},tradeShowLeadReadWhere(actor)]},include:{tradeShow:{select:{archivedAt:true}}}});if(!lead)notFound();if(!canEditTradeShowLead(actor,lead)||!can(actor,'contacts.write')||!can(actor,'trade-shows.resolve'))redirect('/access-denied');
 const [accounts,matches]=await Promise.all([prisma.account.findMany({where:{status:'ACTIVE',archivedAt:null},orderBy:{name:'asc'},select:{id:true,name:true}}),lead.email?prisma.contact.findMany({where:{email:{equals:lead.email,mode:'insensitive'},archivedAt:null},include:{account:{select:{name:true}}}}):Promise.resolve([])]);
 const initial={accountId:lead.accountId,firstName:usable(lead.firstName)??'',lastName:usable(lead.lastName)??'',title:usable(lead.title),email:usable(lead.email),phone:usable(lead.phone),mobile:null,active:true,isPrimary:false,addressLine1:usable(lead.addressLine1),addressLine2:usable(lead.addressLine2),city:usable(lead.city),stateProvince:usable(lead.stateProvince),postalCode:usable(lead.postalCode),country:usable(lead.country)};
 return <Content><PageHeader eyebrow="Trade Show Lead" title="Review new Contact" description="Source values are prefilled for review; placeholder values are removed and the original Lead remains unchanged."/>{matches.length>0&&<div className="mb-5 rounded border border-amber-300 bg-amber-50 p-4"><strong>Exact email match{matches.length===1?'':'es'}</strong><ul className="mt-2 text-sm">{matches.map(match=><li key={match.id}><Link className="text-orange-800 underline" href={`/contacts/${match.id}`}>{match.firstName} {match.lastName}</Link>{match.account?` · ${match.account.name}`:''}</li>)}</ul><p className="mt-2 text-sm">Return to the Lead editor to link an existing match.</p></div>}<ContactForm accounts={accounts} initial={initial} leadContext={{tradeShowId,leadId}}/></Content>;
}
