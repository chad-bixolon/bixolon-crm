'use client';

import { useState } from 'react';
import { ImportSearchPicker } from '@/components/import-search-picker';
import type { RosaManualGroupChoice, RosaPlan, RosaResolution } from '@/lib/rosa-price-exception-import';

type Group = RosaPlan['groups'][number];
type ChoiceKind = 'accountIds'|'userIds'|'skuIds'|'headerLines';

const display=(item:RosaResolution)=>`${item.source||'—'} → ${item.name??item.issue??'Unresolved'}`;
const statusLabels:Record<Group['disposition'],string>={'READY':'Ready to import','REVIEW REQUIRED':'Needs review','ERROR':'Error','EXISTING / NO CHANGE':'Already imported / No changes'};

function ResolutionPicker({label,source,resolved,value,items,disabled,onChange}:{label:string;source:string;resolved:string|null;value:number|null;items:RosaPlan['choices']['accounts'];disabled:boolean;onChange:(value:number|null)=>void}){
  const [editing,setEditing]=useState(false);
  return <div className="rounded border border-amber-200 bg-amber-50/40 p-3 text-xs">
    <p className="font-semibold text-slate-800">{label}</p>
    <p className="mt-1 break-words text-slate-600">Source: {source||'(blank)'}</p>
    {value!==null&&!editing?<p className="mt-1 text-slate-800">Resolved to: <strong>{resolved}</strong> <button type="button" className="ml-2 font-semibold text-orange-800 underline" disabled={disabled} onClick={()=>setEditing(true)}>Change</button></p>:
      <div className="mt-2 max-w-md"><ImportSearchPicker label={`CRM ${label}`} items={items} value={value} disabled={disabled} emptyLabel={`Select ${label.startsWith('SKU')?'SKU':label.includes('By')?'user':'CRM Account'}...`} onChange={id=>{onChange(id);setEditing(false)}}/>{editing&&<button type="button" className="mt-1 text-slate-600 underline" onClick={()=>setEditing(false)}>Cancel</button>}</div>}
  </div>;
}

export function RosaReviewCard({group,plan,manual,disabled,onResolve}:{group:Group;plan:RosaPlan;manual:RosaManualGroupChoice|undefined;disabled:boolean;onResolve:(groupKey:string,kind:ChoiceKind,field:string,value:number|null)=>void}){
  const roleItems=[
    ['Customer','Customer / Distributor',group.customer,'accountIds',plan.choices.accounts],
    ['VAR','VAR',group.varAccount,'accountIds',plan.choices.accounts],
    ['End User','End User',group.endUser,'accountIds',plan.choices.accounts],
    ['Requested By','Requested By',group.requestedBy,'userIds',plan.choices.users],
    ['Reviewed By','Reviewed By',group.reviewedBy,'userIds',plan.choices.users],
  ] as const;
  const visibleMessages=group.messages.filter(message=>!roleItems.some(([field])=>message.startsWith(`${field}: `))&&!/^Line \d+ SKU: /.test(message)&&!group.conflictOptions.some(option=>message.startsWith(`${option.field} differs across source lines:`)));
  const skuCount=new Set(group.tiers.map(tier=>tier.sku.source.trim().toUpperCase())).size;
  return <article className="rounded border border-slate-200 p-4">
    <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">PE {group.peNumber||'(missing number)'}</h3><span className="rounded bg-slate-100 px-2 py-1 text-xs">{statusLabels[group.disposition]}</span><span className="text-xs text-slate-600">{group.sourceLines.length} source row{group.sourceLines.length===1?'':'s'} · {skuCount} SKU{skuCount===1?'':'s'} · {group.tiers.length} pricing tier{group.tiers.length===1?'':'s'}</span></div>
    <p className="mt-2 text-xs text-slate-600">Status {group.statusSource} → {group.statusMapped??'Unmapped'} · Expires {group.expirationDate} · Requested {group.requestedAt} · Reviewed {group.reviewedAt}</p>
    <p className="mt-1 text-xs">Requested by: {display(group.requestedBy)} · Reviewed by: {display(group.reviewedBy)}</p>
    <p className="mt-1 text-xs">Customer: {display(group.customer)} · VAR: {display(group.varAccount)} · End User: {display(group.endUser)}</p>
    <p className="mt-1 whitespace-pre-wrap text-xs">Description: {group.description}</p>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50"><tr><th className="p-2">Source line</th><th className="p-2">SKU / resolution</th><th className="p-2">Quantity</th><th className="p-2">Original price</th><th className="p-2">Approved price</th></tr></thead><tbody className="divide-y">{group.tiers.map(tier=><tr key={tier.line}><td className="p-2">{tier.line}</td><td className="p-2">{display(tier.sku)}</td><td className="p-2">{tier.quantity}</td><td className="p-2">{tier.currency} {tier.originalPrice}</td><td className="p-2">{tier.currency} {tier.approvedPrice}</td></tr>)}</tbody></table></div>
    {(roleItems.some(([field,,item,kind])=>!!item.issue||!!(kind==='accountIds'?manual?.accountIds?.[field as 'Customer'|'VAR'|'End User']:manual?.userIds?.[field as 'Requested By'|'Reviewed By']))||group.tiers.some(tier=>tier.sku.issue||manual?.skuIds?.[tier.line])||group.conflictOptions.length>0)&&<div className="mt-3 space-y-2"><h4 className="text-sm font-semibold">Review and resolve</h4>
      {roleItems.map(([field,label,item,kind,items])=>{const value=kind==='accountIds'?manual?.accountIds?.[field as 'Customer'|'VAR'|'End User']??null:manual?.userIds?.[field as 'Requested By'|'Reviewed By']??null;return (item.issue||value!==null)&&<ResolutionPicker key={field} label={label} source={item.source} resolved={item.name} value={value} items={items} disabled={disabled} onChange={id=>onResolve(group.groupKey,kind,field,id)}/>})}
      {group.tiers.filter(tier=>tier.sku.issue||manual?.skuIds?.[tier.line]).map(tier=><ResolutionPicker key={tier.line} label={`SKU on source line ${tier.line}`} source={tier.sku.source} resolved={tier.sku.name} value={manual?.skuIds?.[tier.line]??null} items={plan.choices.skus} disabled={disabled} onChange={id=>onResolve(group.groupKey,'skuIds',String(tier.line),id)}/>)}
      {group.conflictOptions.map(option=><div key={option.field} className="rounded border border-amber-200 bg-amber-50/40 p-3 text-xs"><p className="font-semibold">Conflicting {option.field}</p><p className="mt-1 text-slate-600">Choose the source value for the PE header. All original rows remain in import metadata.</p><ul className="mt-1 space-y-1">{option.values.map(value=><li key={value.line}>Line {value.line}: {value.value||'(blank)'}</li>)}</ul><select className="field mt-2 h-8 max-w-md text-xs" aria-label={`Resolve conflicting ${option.field}`} disabled={disabled} value={manual?.headerLines?.[option.field]??''} onChange={event=>onResolve(group.groupKey,'headerLines',option.field,event.target.value?Number(event.target.value):null)}><option value="">Select source value...</option>{option.values.map(value=><option key={value.line} value={value.line}>Line {value.line}: {value.value||'(blank)'}</option>)}</select></div>)}
    </div>}
    {group.changedFields.length>0&&<p className="mt-2 text-sm font-medium text-amber-800">Different from existing PE: {group.changedFields.join(', ')}</p>}
    {visibleMessages.length>0&&<ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{visibleMessages.map((message,index)=><li key={`${index}-${message}`}>{message}</li>)}</ul>}
  </article>;
}
