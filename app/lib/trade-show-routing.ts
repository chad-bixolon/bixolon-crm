import { AccountBusinessRoleCode, TradeShowLeadRouting, type Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';

export const TRADE_SHOW_ROUTINGS = Object.values(TradeShowLeadRouting);
export const PARTNER_ACCOUNT_ROLES: AccountBusinessRoleCode[] = ['DISTRIBUTOR','VAR','ISV','OEM','PARTNER'];
export const tradeShowRoutingLabels: Record<TradeShowLeadRouting,string> = {
  UNREVIEWED: 'Unreviewed',
  BIXOLON_SALES: 'BIXOLON Sales',
  REFERRED_TO_PARTNER: 'Referred to Partner',
  MARKETING_FOLLOW_UP: 'Marketing Follow-Up',
};

export const eligiblePartnerAccountWhere = {
  status: 'ACTIVE', archivedAt: null,
  businessRoles: { some: { role: { in: PARTNER_ACCOUNT_ROLES } } },
} satisfies Prisma.AccountWhereInput;

type RoutingClient = Pick<PrismaClient,'user'|'account'>;
export async function validateTradeShowRouting(client: RoutingClient, routing: TradeShowLeadRouting, repId: number|null, partnerAccountId: number|null) {
  if (routing === 'BIXOLON_SALES') {
    if (!repId) throw new Error('Select an active Sales rep for BIXOLON Sales routing.');
    const rep = await client.user.findFirst({where:{id:repId,active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}},select:{id:true}});
    if (!rep) throw new Error('Choose an active Sales rep.');
  } else if (repId) {
    const rep = await client.user.findFirst({where:{id:repId,active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}},select:{id:true}});
    if (!rep) throw new Error('Choose an active Sales rep.');
  }
  if (routing === 'REFERRED_TO_PARTNER') {
    if (!partnerAccountId) throw new Error('Select a Partner Account for partner routing.');
    const partner = await client.account.findFirst({where:{id:partnerAccountId,...eligiblePartnerAccountWhere},select:{id:true}});
    if (!partner) throw new Error('Choose an active Account with an eligible partner Business Role.');
  }
}

export function canRouteTradeShowLead(actor: Actor, lead: {assignedSalesRepUserId:number|null}) {
  return can(actor,'trade-shows.route') && (actor.role !== 'SALES' || lead.assignedSalesRepUserId === actor.id);
}

export function referralData(routing: TradeShowLeadRouting, priorRouting: TradeShowLeadRouting, actorId: number, notes: string|null, priorReferredAt:Date|null=null) {
  return routing === 'REFERRED_TO_PARTNER' && !priorReferredAt
    ? {referredAt:new Date(),referredByUserId:actorId,referralNotes:notes}
    : routing === 'REFERRED_TO_PARTNER' && priorRouting === 'REFERRED_TO_PARTNER'
      ? {referralNotes:notes}
      : {};
}

export async function bulkRouteTradeShowLeads(client:PrismaClient,tradeShowId:number,leadIds:number[],routing:TradeShowLeadRouting,repId:number|null,partnerAccountId:number|null,notes:string|null,actor:Actor){
  if(!can(actor,'trade-shows.assign')||!can(actor,'trade-shows.route'))throw new Error('Access denied');
  const ids=[...new Set(leadIds)];if(!ids.length)throw new Error('Select at least one lead.');
  return client.$transaction(async tx=>{
    const show=await tx.tradeShow.findUnique({where:{id:tradeShowId},select:{archivedAt:true}});if(!show||show.archivedAt)throw new Error('Trade Show not found or archived.');
    const leads=await tx.tradeShowLead.findMany({where:{tradeShowId,id:{in:ids}},select:{id:true,routing:true,referredAt:true}});
    if(leads.length!==ids.length)throw new Error('One or more selected leads are unavailable.');
    await validateTradeShowRouting(tx,routing,repId,partnerAccountId);
    for(const lead of leads)await tx.tradeShowLead.update({where:{id:lead.id},data:{routing,assignedSalesRepUserId:repId,...(routing==='REFERRED_TO_PARTNER'?{routedPartnerAccountId:partnerAccountId}:{}),...referralData(routing,lead.routing,actor.id,notes,lead.referredAt)}});
    return leads.length;
  });
}
