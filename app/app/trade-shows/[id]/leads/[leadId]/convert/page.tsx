import { notFound, redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { OpportunityForm } from '@/components/opportunity-form';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { opportunityOptions } from '@/lib/opportunities';
import { getLabels } from '@/lib/configuration';
import { canConvertTradeShowLead } from '@/lib/trade-show-conversion';
import { tradeShowLeadReadWhere } from '@/lib/trade-shows';
import { submitTradeShowConversion } from './actions';

export const dynamic = 'force-dynamic';
export default async function ConvertTradeShowLeadPage({params}:{params:Promise<{id:string;leadId:string}>}) {
  const actor=await currentUser();
  const values=await params, tradeShowId=Number(values.id), leadId=Number(values.leadId);
  if(!Number.isSafeInteger(tradeShowId)||tradeShowId<1||!Number.isSafeInteger(leadId)||leadId<1) notFound();
  const [lead,options,labels]=await Promise.all([
    prisma.tradeShowLead.findFirst({where:{AND:[{id:leadId,tradeShowId},tradeShowLeadReadWhere(actor)]},include:{tradeShow:{select:{name:true,archivedAt:true}},account:{select:{name:true}}}}),
    opportunityOptions(prisma),getLabels(prisma),
  ]);
  if(!lead) notFound();
  if(!canConvertTradeShowLead(actor,lead)) redirect('/access-denied');
  if(lead.tradeShow.archivedAt) redirect(`/trade-shows/${tradeShowId}/leads/${leadId}`);
  if(lead.convertedOpportunityId) redirect(`/trade-shows/${tradeShowId}/leads/${leadId}`);
  if(!lead.accountId||!lead.account) redirect(`/trade-shows/${tradeShowId}/leads/${leadId}/edit`);
  const assignedEligible=lead.assignedSalesRepUserId&&options.owners.some(owner=>owner.id===lead.assignedSalesRepUserId);
  const ownerId=actor.role==='SALES'?actor.id:assignedEligible?lead.assignedSalesRepUserId:actor.id;
  const initial={name:`${lead.account.name} - ${lead.tradeShow.name}`,description:null,competitorId:lead.competitorId,currentProductBeingUsed:lead.currentProductBeingUsed,customerPainPoints:lead.customerPainPoints,ownerId,projectIds:[],stageId:0,expectedCloseDate:null,probability:null,forecastCategory:null,currencyCode:'USD',participants:[{accountId:lead.accountId,roles:[]}],contacts:lead.contactId?[{contactId:lead.contactId,isPrimary:true}]:[],lines:[]};
  const owners=actor.role==='SALES'?options.owners.filter(owner=>owner.id===actor.id):options.owners;
  return <Content><PageHeader eyebrow="Trade Show Conversion" title={`Create Opportunity for ${lead.firstName} ${lead.lastName}`} description="Review every sales field before creating the Opportunity."/><OpportunityForm {...options} owners={owners} labels={labels} initial={initial} conversionAction={submitTradeShowConversion.bind(null,tradeShowId,leadId)} conversion={{tradeShowId,leadId,tradeShowName:lead.tradeShow.name,productInterest:lead.productInterest,sourceNotes:lead.sourceNotes}}/></Content>;
}
