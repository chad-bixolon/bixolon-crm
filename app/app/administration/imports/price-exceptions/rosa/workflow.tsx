'use client';

import { useState } from 'react';
import { ImportFileSelector } from '@/components/import-file-selector';
import type { RosaDisposition, RosaManualChoices, RosaManualGroupChoice, RosaPlan } from '@/lib/rosa-price-exception-import';
import { applyRosa, previewRosa, reviewRosa } from './actions';
import { PreviewActions } from './preview-actions';
import { RosaReviewCard } from './review-card';

const statusLabels:Record<RosaDisposition,string>={'READY':'Ready to import','REVIEW REQUIRED':'Needs review','ERROR':'Error','EXISTING / NO CHANGE':'Already imported / No changes'};
type ChoiceKind='accountIds'|'userIds'|'skuIds'|'headerLines';

export function RosaImportWorkflow(){
  const [file,setFile]=useState<File|null>(null);
  const [plan,setPlan]=useState<RosaPlan|null>(null);
  const [choices,setChoices]=useState<RosaManualChoices>({});
  const [busy,setBusy]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [message,setMessage]=useState('');
  const form=()=>{const data=new FormData();if(file)data.set('file',file);return data};

  async function preview(){
    if(!file)return;
    setBusy(true);setPlan(null);setChoices({});setConfirmed(false);setMessage('');
    try{const response=await previewRosa(form());if(response.plan)setPlan(response.plan);else setMessage(response.error??'Preview failed.')}catch{setMessage('Preview failed.')}finally{setBusy(false)}
  }

  async function resolve(groupKey:string,kind:ChoiceKind,field:string,value:number|null){
    if(!file||!plan||busy)return;
    const prior=choices[groupKey]??{};
    const fields={...(prior[kind]??{})} as Record<string,number>;
    if(value===null)delete fields[field];else fields[field]=value;
    const next:RosaManualChoices={...choices,[groupKey]:{...prior,[kind]:fields} as RosaManualGroupChoice};
    setBusy(true);setMessage('');setConfirmed(false);
    try{
      const response=await reviewRosa(form(),choices,next,plan.digest);
      if(response.plan){setPlan(response.plan);setChoices(next)}
      else{setMessage(response.error??'Resolution could not be reviewed.');if(response.error?.includes('Preview changed'))setPlan(null)}
    }catch{setMessage('Resolution could not be reviewed. Preview the file again.');setPlan(null)}finally{setBusy(false)}
  }

  async function apply(){
    if(!file||!plan||!confirmed)return;
    setBusy(true);setMessage('');
    try{const response=await applyRosa(form(),plan.digest,confirmed,choices);if(response.ok){setMessage(`Imported ${response.result.created} Price Exceptions with ${response.result.lines} pricing tiers; skipped ${response.result.skipped}.`);setPlan(null);setChoices({});setConfirmed(false)}else{setMessage(response.message);setPlan(null);setChoices({});setConfirmed(false)}}catch{setMessage('Import failed. Preview the file again.');setPlan(null);setChoices({})}finally{setBusy(false)}
  }

  return <div className="space-y-5">
    <section className="panel p-5"><h2 className="text-lg font-semibold">Upload CSV</h2><p className="mt-2 text-sm text-slate-600">Rows with the same PE Number become one Price Exception when their header details agree. Each quantity or SKU tier remains a separate pricing line. Approved maps to Active; original status and timestamps remain in metadata. No Accounts, Users, Products, or SKUs are created.</p><div className="mt-4 flex flex-wrap items-center gap-3"><ImportFileSelector ariaLabel="Price Exception CSV file" buttonText="Choose CSV File" accept=".csv,text/csv" filename={file?.name} onFileChange={selected=>{setFile(selected??null);setPlan(null);setChoices({});setConfirmed(false)}}/><button className="btn-primary" disabled={!file||busy} onClick={()=>void preview()}>Preview Import</button></div></section>
    {message&&<p role="status" className="panel p-4 text-sm">{message}</p>}
    {plan&&<section className="panel p-5"><h2 className="text-lg font-semibold">2. Review {plan.groups.length} Price Exceptions from {plan.sourceRowCount} rows</h2><div className="mt-3 flex flex-wrap gap-3">{Object.entries(plan.counts).map(([status,count])=><span className="rounded bg-slate-100 px-3 py-2 text-sm" key={status}><strong>{count}</strong> {statusLabels[status as RosaDisposition]}</span>)}</div>{plan.errors.map(error=><p key={error} className="mt-2 text-red-800">{error}</p>)}<div className="mt-4 max-h-[650px] space-y-3 overflow-auto">{plan.groups.map(group=><RosaReviewCard key={group.groupKey} group={group} plan={plan} manual={choices[group.groupKey]} disabled={busy} onResolve={(groupKey,kind,field,value)=>void resolve(groupKey,kind,field,value)}/>)}</div><PreviewActions plan={plan} confirmed={confirmed} busy={busy} onConfirm={setConfirmed} onApply={()=>void apply()}/></section>}
  </div>;
}
