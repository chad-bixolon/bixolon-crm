'use client';
import { useActionState } from 'react';
import { savePriceExceptionFollowUp } from '@/app/price-exceptions/[id]/actions';
import { followUpLabels, followUpStatuses } from '@/lib/price-exception-follow-up';
import type { PriceExceptionFollowUpStatus } from '@prisma/client';

export function PriceExceptionFollowUpForm({id,status,ownerId,owners,canReassign,nextDate,replacementId,replacementNumber}:{id:number;status:PriceExceptionFollowUpStatus;ownerId:number|null;owners:{id:number;firstName:string;lastName:string}[];canReassign:boolean;nextDate:string;replacementId:number|null;replacementNumber:string}) {
  const [state,action,pending]=useActionState(savePriceExceptionFollowUp.bind(null,id),{} as {error?:string;saved?:boolean});
  return <form action={action} className="mt-4 rounded border border-slate-200 p-4 text-sm">
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      <label className="label">Follow-up Status<select className="field mt-1" name="status" defaultValue={status}>{followUpStatuses.map(value=><option key={value} value={value}>{followUpLabels[value]}</option>)}</select></label>
      <label className="label">Follow-up Owner{canReassign?<select className="field mt-1" name="ownerId" defaultValue={ownerId??''}><option value="">Unassigned</option>{owners.map(owner=><option key={owner.id} value={owner.id}>{owner.firstName} {owner.lastName}</option>)}</select>:<><input type="hidden" name="ownerId" value={ownerId??''}/><span className="mt-1 block font-normal">{owners.find(owner=>owner.id===ownerId)?`${owners.find(owner=>owner.id===ownerId)!.firstName} ${owners.find(owner=>owner.id===ownerId)!.lastName}`:'Unassigned'}</span></>}</label>
      <label className="label">Next Follow-up Date<input className="field mt-1" type="date" name="nextFollowUpAt" defaultValue={nextDate}/></label>
      <label className="label">Replacement PE system ID<input className="field mt-1" inputMode="numeric" name="replacementPriceExceptionId" defaultValue={replacementId??''} placeholder="Link an existing PE"/></label>
      <label className="label">Replacement PE number / reference<input className="field mt-1" name="replacementPeNumber" maxLength={100} defaultValue={replacementNumber} placeholder="If not yet in SalesHub"/></label>
      <label className="label md:col-span-2 lg:col-span-3">Follow-up note or current summary<textarea className="field mt-1 min-h-20" name="note" maxLength={2000} placeholder="Record the action taken or update the summary"/></label>
    </div>
    <div className="mt-3 form-action-row"><button className="btn-primary" disabled={pending}>Save Follow-up</button>{followUpStatuses.filter(value=>value!=='NOT_STARTED').map(value=><button key={value} className="btn-secondary" name="actionStatus" value={value} disabled={pending}>{status==='NOT_STARTED'&&value==='IN_PROGRESS'?'Start Follow-up':followUpLabels[value]}</button>)}{state.error&&<span className="text-red-700">{state.error}</span>}{state.saved&&<span className="text-green-700">Saved</span>}</div>
  </form>;
}
