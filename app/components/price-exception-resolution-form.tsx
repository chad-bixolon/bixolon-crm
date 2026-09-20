'use client';
import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { resolvePriceExceptionAccounts, type ResolvePriceExceptionState } from '@/app/price-exceptions/[id]/actions';
import { PriceExceptionAccountPicker, type PriceExceptionAccountOption } from './price-exception-account-picker';

type Party={field:'distributorAccountId'|'varAccountId'|'endUserAccountId';label:string;source:string|null;account:PriceExceptionAccountOption|null};
export function PriceExceptionResolutionForm({id,parties}:{id:number;parties:Party[]}){
  const router=useRouter();
  const [state,action,pending]=useActionState(resolvePriceExceptionAccounts.bind(null,id),{errors:{}} as ResolvePriceExceptionState);
  useEffect(()=>{if(state.saved){router.replace(`/price-exceptions/${id}`);router.refresh()}},[id,router,state.saved]);
  return <section className="panel mb-5 border-orange-200 p-6" aria-labelledby="resolve-references-heading">
    <div className="mb-5"><h2 id="resolve-references-heading" className="text-lg font-semibold">Resolve Account References</h2><p className="mt-1 text-sm text-slate-600">Link the imported party names to existing CRM Accounts. Source values remain unchanged.</p></div>
    {state.errors.form&&<p role="alert" className="mb-4 rounded bg-red-50 p-3 text-sm text-red-800">{state.errors.form}</p>}
    <form action={action} className="space-y-5">
      {parties.map(party=><div key={party.field} className="grid gap-2 rounded border border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-start"><div><p className="label">{party.label}</p><p className="mt-1 text-sm"><span className="text-slate-500">Source value:</span> {party.source??'—'}</p></div><PriceExceptionAccountPicker name={party.field} label="Linked CRM Account" initial={party.account} error={state.errors[party.field]}/></div>)}
      <div className="flex justify-end gap-2"><Link className="btn-secondary" href={`/price-exceptions/${id}`}>Cancel</Link><button className="btn-primary" disabled={pending} type="submit">{pending?'Saving…':'Save Account Links'}</button></div>
    </form>
  </section>;
}
