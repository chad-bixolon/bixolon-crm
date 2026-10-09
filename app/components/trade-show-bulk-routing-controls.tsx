'use client';
import {useState} from 'react';
import type {TradeShowLeadRouting} from '@prisma/client';
import { EntityPicker } from './entity-picker';

type Option={id:number;name:string};
export function TradeShowBulkRoutingControls({reps}:{reps:Option[]}){
  const [routing,setRouting]=useState<TradeShowLeadRouting>('UNREVIEWED');
  return <div className="mx-5 mb-3 flex flex-wrap items-end gap-2 rounded border border-orange-200 bg-orange-50/60 p-3">
    <label className="text-xs font-semibold">Route selected<select className="field mt-1" name="bulkRouting" value={routing} onChange={event=>setRouting(event.target.value as TradeShowLeadRouting)} required><option value="UNREVIEWED">Unreviewed</option><option value="BIXOLON_SALES">BIXOLON Sales</option><option value="REFERRED_TO_PARTNER">Referred to Partner</option><option value="MARKETING_FOLLOW_UP">Marketing Follow-Up</option></select></label>
    {routing!=='UNREVIEWED'&&<label className="text-xs font-semibold">Sales Rep {routing==='BIXOLON_SALES'?'(required)':'(optional)'}<select className="field mt-1" name="bulkRepId" required={routing==='BIXOLON_SALES'}><option value="">No rep</option>{reps.map(rep=><option key={rep.id} value={rep.id}>{rep.name}</option>)}</select></label>}
    {routing==='REFERRED_TO_PARTNER'&&<><div className="min-w-60"><EntityPicker type="account" label="Partner Account (required)" name="bulkPartnerAccountId" filters={{ partnerOnly: true }} required/></div><label className="text-xs font-semibold">Referral Notes<input className="field mt-1 max-w-64" name="bulkReferralNotes" maxLength={20000}/></label></>}
    <button className="btn-primary h-9">Apply Routing</button>
  </div>;
}
