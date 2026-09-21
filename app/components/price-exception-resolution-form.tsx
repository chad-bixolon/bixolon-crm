'use client';
import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { assignPriceExceptionSalesRep, resolvePriceExceptionAccounts, type AssignPriceExceptionSalesRepState, type ResolvePriceExceptionState } from '@/app/price-exceptions/[id]/actions';
import { PriceExceptionAccountPicker, type PriceExceptionAccountOption } from './price-exception-account-picker';

type Party={field:'distributorAccountId'|'varAccountId'|'endUserAccountId';label:string;source:string|null;account:PriceExceptionAccountOption|null};
type SalesRep={id:number;firstName:string;lastName:string;active:boolean;archivedAt:string|null};
export function PriceExceptionResolutionForm({id,parties,salesReps,assignedSalesRepUserId}:{id:number;parties:Party[];salesReps:SalesRep[];assignedSalesRepUserId:number|null}){
  const router=useRouter();
  const [state,action,pending]=useActionState(resolvePriceExceptionAccounts.bind(null,id),{errors:{}} as ResolvePriceExceptionState);
  const [repState,repAction,repPending]=useActionState(assignPriceExceptionSalesRep.bind(null,id),{value:assignedSalesRepUserId?String(assignedSalesRepUserId):''} as AssignPriceExceptionSalesRepState);
  useEffect(()=>{if(state.saved){router.replace(`/price-exceptions/${id}`);router.refresh()}},[id,router,state.saved]);
  return <section className="panel mb-5 border-orange-200 p-6" aria-labelledby="resolve-references-heading">
    <div className="mb-6 border-b border-slate-200 pb-6"><h2 className="text-lg font-semibold">Assign BIXOLON Sales Rep</h2><p className="mt-1 text-sm text-slate-600">This assignment is separate from the sales rep names in the imported record.</p><form action={repAction} className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-72 flex-1 text-xs font-semibold">Sales Rep<select className="field mt-1" name="assignedSalesRepUserId" defaultValue={repState.value??(assignedSalesRepUserId?String(assignedSalesRepUserId):'')}><option value="">Clear assignment</option>{salesReps.map(rep=><option key={rep.id} value={rep.id}>{rep.firstName} {rep.lastName}{!rep.active||rep.archivedAt?' (inactive / historical)':''}</option>)}</select>{repState.error&&<span className="mt-1 block text-red-700">{repState.error}</span>}</label><button className="btn-primary" disabled={repPending} type="submit">{repPending?'Saving…':'Save Sales Rep'}</button>{repState.saved&&<span className="text-sm text-green-700">Saved.</span>}</form></div>
    <div className="mb-5"><h2 id="resolve-references-heading" className="text-lg font-semibold">Resolve Account References</h2><p className="mt-1 text-sm text-slate-600">Link imported names to existing Accounts. The imported names remain visible.</p></div>
    {state.errors.form&&<p role="alert" className="mb-4 rounded bg-red-50 p-3 text-sm text-red-800">{state.errors.form}</p>}
    <form action={action} className="space-y-5">
      {parties.map(party=><div key={party.field} className="grid gap-2 rounded border border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-start"><div><p className="label">{party.label}</p><p className="mt-1 text-sm"><span className="text-slate-500">Source value:</span> {party.source??'—'}</p></div><PriceExceptionAccountPicker name={party.field} label="Linked CRM Account" initial={party.account} error={state.errors[party.field]}/></div>)}
      <div className="flex justify-end gap-2"><Link className="btn-secondary" href={`/price-exceptions/${id}`}>Cancel</Link><button className="btn-primary" disabled={pending} type="submit">{pending?'Saving…':'Save Account Links'}</button></div>
    </form>
  </section>;
}
