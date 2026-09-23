'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { submitTradeShowLead, type TradeShowLeadFormState } from '@/app/trade-shows/[id]/leads/[leadId]/actions';
import { useSubmitGuard } from '@/lib/submit-guard';
import type { TradeShowLeadRouting, TradeShowLeadStatus } from '@prisma/client';

type Option = { id: number; name: string };
type Lead = {
  status: TradeShowLeadStatus; followUpAt: Date | null; lastContactedAt: Date | null; salesNotes: string | null;
  productInterest: string | null; competitorSourceText: string | null; competitorId: number | null;
  currentProductBeingUsed: string | null; customerPainPoints: string | null;
  assignedSalesRepUserId: number | null; accountId: number | null; contactId: number | null;
  routing: TradeShowLeadRouting; routedPartnerAccountId: number|null; referralNotes:string|null;
};
const statuses: TradeShowLeadStatus[] = ['NEW','CONTACTED','QUALIFIED','CONVERTED','DISQUALIFIED'];
const statusLabels: Record<TradeShowLeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
  DISQUALIFIED: 'Disqualified',
};
const tradeShowRoutingLabels:Record<TradeShowLeadRouting,string>={UNREVIEWED:'Unreviewed',BIXOLON_SALES:'BIXOLON Sales',REFERRED_TO_PARTNER:'Referred to Partner',MARKETING_FOLLOW_UP:'Marketing Follow-Up'};
export function TradeShowLeadForm({ tradeShowId, leadId, initial, reps, partnerAccounts, accounts, contacts, competitors, canAssign, canResolve, canRoute }: {
  tradeShowId: number; leadId: number; initial: Lead; reps: Option[]; partnerAccounts:Option[]; accounts: Option[]; contacts: Option[]; competitors: Option[]; canAssign: boolean; canResolve: boolean; canRoute:boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitTradeShowLead.bind(null, tradeShowId, leadId), { errors: {} } as TradeShowLeadFormState);
  const guard = useSubmitGuard(state);
  const [routing,setRouting]=useState<TradeShowLeadRouting>((state.values?.routing as TradeShowLeadRouting|undefined)??initial.routing);
  const [partnerSearch,setPartnerSearch]=useState('');
  useEffect(() => { if (state.redirectTo) router.push(state.redirectTo); }, [state.redirectTo, router]);
  const val = (key: string, fallback = '') => state.values?.[key] ?? fallback;
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  const textarea = (key: string, label: string, current: string | null, limit: number, rows = 3) => <div className="min-w-0"><label className="label" htmlFor={key}>{label}</label><textarea className="field min-h-20 resize-y" rows={rows} id={key} name={key} maxLength={limit} defaultValue={val(key, current ?? '')}/>{error(key)}</div>;
  const select = (key: string, label: string, current: number | null, options: Option[], emptyLabel: string, inactiveLabel: string) => <div className="min-w-0"><label className="label" htmlFor={key}>{label}</label><select className="field h-11 min-w-0" id={key} name={key} defaultValue={val(key, current?.toString() ?? '')}><option value="">{emptyLabel}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}{current && !options.some(option => option.id === current) && <option value={current}>{inactiveLabel}</option>}</select>{error(key)}</div>;
  return <form key={JSON.stringify(state.values ?? {})} action={action} onSubmit={guard} className="panel max-w-5xl space-y-7 p-5 sm:p-6" aria-label="Edit Trade Show Lead">
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <section><h2 className="mb-3 text-lg font-semibold">Status &amp; Follow-Up</h2><div className="grid min-w-0 gap-5 sm:grid-cols-2">
      <div className="min-w-0"><label className="label" htmlFor="status">Status</label><select className="field h-11 min-w-0" id="status" name="status" defaultValue={val('status', initial.status)}>{statuses.filter(status => initial.status === 'CONVERTED' ? status === 'CONVERTED' : status !== 'CONVERTED').map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>{error('status')}</div>
      <div className="min-w-0"><label className="label" htmlFor="followUpAt">Follow-Up Date</label><input className="field h-11 min-w-0" type="date" id="followUpAt" name="followUpAt" defaultValue={val('followUpAt', initial.followUpAt?.toISOString().slice(0,10) ?? '')}/>{error('followUpAt')}</div>
      <div className="min-w-0"><label className="label" htmlFor="lastContactedAt">Last Contacted Date</label><input className="field h-11 min-w-0" type="date" id="lastContactedAt" name="lastContactedAt" defaultValue={val('lastContactedAt', initial.lastContactedAt?.toISOString().slice(0,10) ?? '')}/>{error('lastContactedAt')}</div>
      <div className="min-w-0 sm:col-span-2">{textarea('salesNotes', 'Sales Notes', initial.salesNotes, 20000, 4)}</div>
    </div></section>
    {canRoute && <section className="rounded-md border border-orange-200 bg-orange-50/40 p-4"><h2 className="mb-1 text-lg font-semibold">Lead Routing</h2><p className="mb-4 text-sm text-slate-600">Routing identifies who handles the lead; it does not change lifecycle status.</p><div className="grid min-w-0 gap-5 sm:grid-cols-2">
      <div><label className="label" htmlFor="routing">Routing</label><select className="field h-11" id="routing" name="routing" value={routing} onChange={event=>setRouting(event.target.value as TradeShowLeadRouting)}>{(Object.keys(tradeShowRoutingLabels) as TradeShowLeadRouting[]).map(value=><option value={value} key={value}>{tradeShowRoutingLabels[value]}</option>)}</select>{error('routing')}</div>
      {canAssign&&select('assignedSalesRepUserId',routing==='BIXOLON_SALES'?'Assigned Sales Rep (required)':'Assigned Sales Rep (optional)',initial.assignedSalesRepUserId,reps,'Unassigned','Current sales rep (inactive)')}
      <div className="min-w-0"><label className="label" htmlFor="partner-search">Partner Account {routing==='REFERRED_TO_PARTNER'?'(required)':'(historical / optional)'}</label><input className="field mb-1 h-9" id="partner-search" type="search" placeholder="Search eligible partner Accounts" value={partnerSearch} onChange={event=>setPartnerSearch(event.target.value)}/><select className="field h-11" name="routedPartnerAccountId" defaultValue={val('routedPartnerAccountId',initial.routedPartnerAccountId?.toString()??'')}><option value="">No partner selected</option>{partnerAccounts.filter(item=>!partnerSearch||item.name.toLowerCase().includes(partnerSearch.toLowerCase())).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{error('routedPartnerAccountId')}</div>
      <div className="min-w-0">{textarea('referralNotes','Referral Notes',initial.referralNotes,20000,3)}</div>
    </div></section>}
    <section><h2 className="mb-3 text-lg font-semibold">Customer Context</h2><div className="grid min-w-0 gap-5 sm:grid-cols-2">
      <div className="min-w-0 sm:col-span-2">{textarea('productInterest', 'Product Interest', initial.productInterest, 5000)}</div>
      <div className="min-w-0"><label className="label" htmlFor="competitorSourceText">Competitor Mentioned</label><input className="field h-11 min-w-0" id="competitorSourceText" name="competitorSourceText" maxLength={500} defaultValue={val('competitorSourceText', initial.competitorSourceText ?? '')}/>{error('competitorSourceText')}</div>
      {select('competitorId', 'Resolved Competitor', initial.competitorId, competitors, 'No competitor selected', 'Current competitor (inactive)')}
      <div className="min-w-0 sm:col-span-2"><label className="label" htmlFor="currentProductBeingUsed">Current Product Being Used</label><input className="field h-11 min-w-0" id="currentProductBeingUsed" name="currentProductBeingUsed" maxLength={500} defaultValue={val('currentProductBeingUsed', initial.currentProductBeingUsed ?? '')}/>{error('currentProductBeingUsed')}</div>
      <div className="min-w-0 sm:col-span-2">{textarea('customerPainPoints', 'Customer Pain Points', initial.customerPainPoints, 20000)}</div>
    </div></section>
    {canResolve && <section><h2 className="mb-1 text-lg font-semibold">CRM Resolution</h2><p className="mb-4 text-sm text-slate-600">Link this lead to existing CRM records or create reviewed records from the source data.</p><div className="grid min-w-0 gap-5 sm:grid-cols-2"><div className="min-w-0">{select('accountId', 'Account', initial.accountId, accounts, 'Not linked', 'Current account (inactive)')}<Link className="mt-2 inline-flex text-sm font-medium text-orange-800 underline" href={`/trade-shows/${tradeShowId}/leads/${leadId}/account/new`}>Create Account</Link></div><div className="min-w-0">{select('contactId', 'Contact', initial.contactId, contacts, 'Not linked', 'Current contact (inactive)')}<Link className="mt-2 inline-flex text-sm font-medium text-orange-800 underline" href={`/trade-shows/${tradeShowId}/leads/${leadId}/contact/new`}>Create Contact</Link></div><p className="text-xs text-slate-600 sm:col-span-2">A Contact assigned to another Account cannot be linked here. This workflow never reassigns a Contact automatically.</p></div></section>}
    <div className="flex flex-wrap justify-end gap-2"><Link className="btn-secondary" href={`/trade-shows/${tradeShowId}/leads/${leadId}`}>Cancel</Link><button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save Lead'}</button></div>
  </form>;
}
