import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {ContactForm} from '@/components/contact-form';
import {Content,PageHeader} from '@/components/shell';
import {currentUser} from '@/lib/current-user';
import {prisma} from '@/lib/prisma';
import {canManageContactResolution,normalizedEmail,reviewedValue} from '@/lib/trade-show-contact-resolution';

export const dynamic='force-dynamic';
export default async function NewResolutionContactPage({params,searchParams}:{params:Promise<{id:string;leadId:string}>;searchParams:Promise<{returnTo?:string}>}){
  const actor=await currentUser(),raw=await params,tradeShowId=Number(raw.id),leadId=Number(raw.leadId),returnTo=(await searchParams).returnTo??'';
  if(!Number.isSafeInteger(tradeShowId)||!Number.isSafeInteger(leadId))notFound();if(!canManageContactResolution(actor))redirect('/access-denied');
  const lead=await prisma.tradeShowLead.findFirst({where:{id:leadId,tradeShowId,contactId:null},include:{tradeShow:{select:{name:true,archivedAt:true}}}});if(!lead||lead.tradeShow.archivedAt)notFound();
  const email=normalizedEmail(lead.email),[accounts,matches]=await Promise.all([prisma.account.findMany({where:{status:'ACTIVE',archivedAt:null},orderBy:{name:'asc'},select:{id:true,name:true}}),email?prisma.contact.findMany({where:{email:{equals:email,mode:'insensitive'},archivedAt:null},include:{account:{select:{name:true}}}}):Promise.resolve([])]);
  const initial={accountId:lead.accountId,firstName:reviewedValue(lead.firstName)??'',lastName:reviewedValue(lead.lastName)??'',title:reviewedValue(lead.title),email,phone:reviewedValue(lead.phone),mobile:null,active:true,isPrimary:false,addressLine1:null,addressLine2:null,city:null,stateProvince:null,postalCode:null,country:null};
  const back=`/trade-shows/${tradeShowId}/contact-resolution?resolveLead=${lead.id}${returnTo?`&returnTo=${encodeURIComponent(returnTo)}`:''}`;
  return <Content><PageHeader eyebrow="Contact Resolution" title={`Create Contact for ${lead.firstName} ${lead.lastName}`} description="Review the normalized Contact fields below. The original Trade Show lead remains unchanged." action={<Link className="btn-secondary" href={back}>Back to Review</Link>}/>
    {matches.length>0&&<div className="mb-5 rounded border border-amber-300 bg-amber-50 p-4"><strong>Do not create a duplicate Contact</strong><p className="mt-1 text-sm">This email already belongs to {matches.length===1?'a Contact':'multiple Contacts'}. Return to review and explicitly link the correct record.</p><ul className="mt-2 text-sm">{matches.map(match=><li key={match.id}><Link className="font-semibold text-orange-800 underline" href={`/contacts/${match.id}`}>{match.firstName} {match.lastName}</Link>{match.account?` · ${match.account.name}`:' · Unassigned'}</li>)}</ul></div>}
    <ContactForm accounts={accounts} initial={initial} resolutionContext={{tradeShowId,leadId,returnTo}}/>
  </Content>;
}
