'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { submitTradeShowLead, type TradeShowLeadFormState } from '@/app/trade-shows/[id]/leads/[leadId]/actions';
import { useSubmitGuard } from '@/lib/submit-guard';
import type { TradeShowLeadStatus } from '@prisma/client';

type Option = { id: number; name: string };
type Lead = {
  status: TradeShowLeadStatus; followUpAt: Date | null; lastContactedAt: Date | null; salesNotes: string | null;
  productInterest: string | null; competitorSourceText: string | null; competitorId: number | null;
  currentProductBeingUsed: string | null; customerPainPoints: string | null;
  assignedSalesRepUserId: number | null; accountId: number | null; contactId: number | null;
};
const statuses: TradeShowLeadStatus[] = ['NEW','CONTACTED','QUALIFIED','CONVERTED','DISQUALIFIED'];
export function TradeShowLeadForm({ tradeShowId, leadId, initial, reps, accounts, contacts, competitors, canAssign, canResolve }: {
  tradeShowId: number; leadId: number; initial: Lead; reps: Option[]; accounts: Option[]; contacts: Option[]; competitors: Option[]; canAssign: boolean; canResolve: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitTradeShowLead.bind(null, tradeShowId, leadId), { errors: {} } as TradeShowLeadFormState);
  const guard = useSubmitGuard(state);
  useEffect(() => { if (state.redirectTo) router.push(state.redirectTo); }, [state.redirectTo, router]);
  const val = (key: string, fallback = '') => state.values?.[key] ?? fallback;
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  const textarea = (key: string, label: string, current: string | null, limit: number) => <div><label className="label" htmlFor={key}>{label}</label><textarea className="field min-h-20" id={key} name={key} maxLength={limit} defaultValue={val(key, current ?? '')}/>{error(key)}</div>;
  const select = (key: string, label: string, current: number | null, options: Option[]) => <div><label className="label" htmlFor={key}>{label}</label><select className="field" id={key} name={key} defaultValue={val(key, current?.toString() ?? '')}><option value="">Unresolved / none</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}{current && !options.some(option => option.id === current) && <option value={current}>Current record #{current} (inactive)</option>}</select>{error(key)}</div>;
  return <form key={JSON.stringify(state.values ?? {})} action={action} onSubmit={guard} className="panel max-w-4xl space-y-6 p-6">
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <section className="grid gap-4 sm:grid-cols-2"><h2 className="sm:col-span-2 text-lg font-semibold">Status / Follow-Up</h2>
      <div><label className="label" htmlFor="status">Status</label><select className="field" id="status" name="status" defaultValue={val('status', initial.status)}>{statuses.filter(status => initial.status === 'CONVERTED' ? status === 'CONVERTED' : status !== 'CONVERTED').map(status => <option key={status} value={status}>{status}</option>)}</select>{error('status')}</div>
      {canAssign && select('assignedSalesRepUserId', 'Assigned Sales Rep', initial.assignedSalesRepUserId, reps)}
      <div><label className="label" htmlFor="followUpAt">Follow-up Date</label><input className="field" type="date" id="followUpAt" name="followUpAt" defaultValue={val('followUpAt', initial.followUpAt?.toISOString().slice(0,10) ?? '')}/>{error('followUpAt')}</div>
      <div><label className="label" htmlFor="lastContactedAt">Last Contacted Date</label><input className="field" type="date" id="lastContactedAt" name="lastContactedAt" defaultValue={val('lastContactedAt', initial.lastContactedAt?.toISOString().slice(0,10) ?? '')}/>{error('lastContactedAt')}</div>
      <div className="sm:col-span-2">{textarea('salesNotes', 'Sales Notes', initial.salesNotes, 20000)}</div>
    </section>
    <section className="grid gap-4 sm:grid-cols-2"><h2 className="sm:col-span-2 text-lg font-semibold">Customer Context</h2>
      <div className="sm:col-span-2">{textarea('productInterest', 'Product Interest', initial.productInterest, 5000)}</div>
      <div><label className="label" htmlFor="competitorSourceText">Source Competitor Text</label><input className="field" id="competitorSourceText" name="competitorSourceText" maxLength={500} defaultValue={val('competitorSourceText', initial.competitorSourceText ?? '')}/>{error('competitorSourceText')}</div>
      {select('competitorId', 'Resolved Competitor', initial.competitorId, competitors)}
      <div className="sm:col-span-2"><label className="label" htmlFor="currentProductBeingUsed">Current Product Being Used</label><input className="field" id="currentProductBeingUsed" name="currentProductBeingUsed" maxLength={500} defaultValue={val('currentProductBeingUsed', initial.currentProductBeingUsed ?? '')}/>{error('currentProductBeingUsed')}</div>
      <div className="sm:col-span-2">{textarea('customerPainPoints', 'Customer Pain Points', initial.customerPainPoints, 20000)}</div>
    </section>
    {canResolve && <section className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><h2 className="text-lg font-semibold">CRM Resolution</h2><p className="text-sm text-slate-600">Link existing records or create reviewed records from source data. Existing CRM records are never overwritten.</p></div><div>{select('accountId', 'Account', initial.accountId, accounts)}<Link className="mt-2 inline-block text-sm text-orange-800 underline" href={`/trade-shows/${tradeShowId}/leads/${leadId}/account/new`}>Create reviewed Account</Link></div><div>{select('contactId', 'Contact', initial.contactId, contacts)}<Link className="mt-2 inline-block text-sm text-orange-800 underline" href={`/trade-shows/${tradeShowId}/leads/${leadId}/contact/new`}>Create reviewed Contact</Link></div><p className="sm:col-span-2 text-xs text-slate-600">A Contact assigned to another Account cannot be linked here. This workflow never reassigns a Contact automatically.</p></section>}
    <div className="flex justify-end gap-2"><Link className="btn-secondary" href={`/trade-shows/${tradeShowId}/leads/${leadId}`}>Cancel</Link><button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save Lead'}</button></div>
  </form>;
}
