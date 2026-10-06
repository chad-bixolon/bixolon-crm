'use client';
import { useState, useTransition } from 'react';
import { markExpiredPriceException } from '@/app/price-exceptions/[id]/actions';

export function PriceExceptionExpireAction({id,code}:{id:number;code:string}) {
  const [confirm,setConfirm]=useState(false);
  const [error,setError]=useState('');
  const [busy,start]=useTransition();
  return <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm">
    {!confirm?<button type="button" className="btn-secondary" onClick={()=>setConfirm(true)}>Mark Price Exception Expired</button>:<div>
      <p className="font-semibold">Mark PE {code} as Expired?</p>
      <p className="mt-1 text-slate-700">This changes the stored Price Exception status from Active to Expired. Expiration follow-up history and workflow status will remain unchanged.</p>
      <div className="mt-3 flex gap-2"><button type="button" className="btn-primary" disabled={busy} onClick={()=>start(async()=>{const result=await markExpiredPriceException(id);if(!result.ok)setError(result.message);})}>Confirm Set Expired</button><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setConfirm(false);setError('')}}>Cancel</button></div>
      {error&&<p role="alert" className="mt-2 text-red-700">{error}</p>}
    </div>}
  </div>;
}
