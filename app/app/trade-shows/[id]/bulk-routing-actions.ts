'use server';
import { assertModuleEnabled } from '@/lib/module-availability';
import {revalidatePath} from 'next/cache';
import {TradeShowLeadRouting} from '@prisma/client';
import {requireMutation} from '@/lib/current-user';
import {prisma} from '@/lib/prisma';
import {bulkRouteTradeShowLeads,TRADE_SHOW_ROUTINGS,type TradeShowRoutingScope} from '@/lib/trade-show-routing';

import type { BulkRecord } from '@/lib/bulk-action-contract';

export async function bulkRouteTradeShowAction(tradeShowId:number,pageRecords:BulkRecord[],scope:TradeShowRoutingScope,form:FormData){
  await assertModuleEnabled('TRADE_SHOWS');
  const actor=await requireMutation('trade-shows.route');
  try{
    const routing=String(form.get('bulkRouting')??'') as TradeShowLeadRouting;
    if(!TRADE_SHOW_ROUTINGS.includes(routing))throw new Error('Choose a valid lead routing.');
    const id=(name:string)=>{const raw=String(form.get(name)??'');if(!raw)return null;const value=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<1)throw new Error('Choose a valid routing destination.');return value;};
    const leadIds=form.getAll('leadIds').map(Number);
    if(leadIds.some(id=>!pageRecords.some(row=>row.id===id)))throw new Error('Refresh the page and select again.');
    const request={records:leadIds.map(id=>pageRecords.find(row=>row.id===id)!),action:'route',value:'',confirmed:form.get('confirmed')==='true'};
    const notes=String(form.get('bulkReferralNotes')??'').trim();if(notes.length>20000)throw new Error('Referral notes must be 20,000 characters or fewer.');
    const count=await bulkRouteTradeShowLeads(prisma,tradeShowId,request,routing,id('bulkRepId'),id('bulkPartnerAccountId'),notes||null,actor,scope);
    for(const path of ['/trade-shows/my-leads','/tasks','/','/administration/maintenance-history','/administration/audit-history'])revalidatePath(path);
    revalidatePath(`/trade-shows/${tradeShowId}`);
    for(const id of leadIds)revalidatePath(`/trade-shows/${tradeShowId}/leads/${id}`);
    return {success:`${count} lead${count===1?'':'s'} routed successfully.`};
  }catch(error){return {error:error instanceof Error&&!('code' in error)?error.message:'No records changed. Refresh the list and try again.'};}
}
