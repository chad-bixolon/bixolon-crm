'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {TradeShowLeadRouting} from '@prisma/client';
import {requireMutation} from '@/lib/current-user';
import {prisma} from '@/lib/prisma';
import {bulkRouteTradeShowLeads,TRADE_SHOW_ROUTINGS} from '@/lib/trade-show-routing';

export async function bulkRouteTradeShowAction(tradeShowId:number,form:FormData){
  const actor=await requireMutation('trade-shows.route');let message:string;
  try{
    const routing=String(form.get('bulkRouting')??'') as TradeShowLeadRouting;
    if(!TRADE_SHOW_ROUTINGS.includes(routing))throw new Error('Choose a valid lead routing.');
    const id=(name:string)=>{const value=Number(form.get(name));return Number.isSafeInteger(value)&&value>0?value:null};
    const leadIds=form.getAll('leadIds').map(Number).filter(value=>Number.isSafeInteger(value)&&value>0);
    const notes=String(form.get('bulkReferralNotes')??'').trim();if(notes.length>20000)throw new Error('Referral notes must be 20,000 characters or fewer.');
    const count=await bulkRouteTradeShowLeads(prisma,tradeShowId,leadIds,routing,id('bulkRepId'),id('bulkPartnerAccountId'),notes||null,actor);
    revalidatePath(`/trade-shows/${tradeShowId}`);message=`${count} lead${count===1?'':'s'} routed successfully.`;
  }catch(error){message=`Error: ${error instanceof Error?error.message:'Leads could not be routed.'}`;}
  redirect(`/trade-shows/${tradeShowId}?bulk=${encodeURIComponent(message)}`);
}
