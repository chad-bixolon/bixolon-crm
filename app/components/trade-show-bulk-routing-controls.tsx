'use client';
import {useState} from 'react';
import type {TradeShowLeadRouting} from '@prisma/client';

type Option={id:number;name:string};
export function TradeShowBulkRoutingControls({reps,partners}:{reps:Option[];partners:Option[]}){
  const [routing,setRouting]=useState<TradeShowLeadRouting>('UNREVIEWED'),[search,setSearch]=useState('');
  const filtered=partners.filter(item=>!search||item.name.toLowerCase().includes(search.toLowerCase())).slice(0,30);
  return <div className="mx-5 mb-3 flex flex-wrap items-end gap-2 rounded border border-orange-200 bg-orange-50/60 p-3">
    <label className="text-xs font-semibold">Route selected<select className="field mt-1 h-9 text-sm" name="bulkRouting" value={routing} onChange={event=>setRouting(event.target.value as TradeShowLeadRouting)} required><option value="UNREVIEWED">Unreviewed</option><option value="BIXOLON_SALES">BIXOLON Sales</option><option value="REFERRED_TO_PARTNER">Referred to Partner</option><option value="MARKETING_FOLLOW_UP">Marketing Follow-Up</option></select></label>
    {routing!=='UNREVIEWED'&&<label className="text-xs font-semibold">Sales Rep {routing==='BIXOLON_SALES'?'(required)':'(optional)'}<select className="field mt-1 h-9 text-sm" name="bulkRepId" required={routing==='BIXOLON_SALES'}><option value="">No rep</option>{reps.map(rep=><option key={rep.id} value={rep.id}>{rep.name}</option>)}</select></label>}
    {routing==='REFERRED_TO_PARTNER'&&<><label className="text-xs font-semibold">Search Partner<input className="field mt-1 h-9 max-w-56 text-sm" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Active partner Accounts"/></label><label className="text-xs font-semibold">Partner Account (required)<select className="field mt-1 h-9 max-w-60 text-sm" name="bulkPartnerAccountId" required><option value="">Select partner</option>{filtered.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="text-xs font-semibold">Referral Notes<input className="field mt-1 h-9 max-w-64 text-sm" name="bulkReferralNotes" maxLength={20000}/></label></>}
    <button className="btn-primary h-9">Apply Routing</button>
  </div>;
}
