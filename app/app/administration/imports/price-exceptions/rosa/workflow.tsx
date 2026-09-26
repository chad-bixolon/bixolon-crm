'use client';

import { useState } from 'react';
import { ImportFileSelector } from '@/components/import-file-selector';
import type { RosaDisposition, RosaManualChoices, RosaManualGroupChoice, RosaPlan } from '@/lib/rosa-price-exception-import';
import { applyRosa, createRosaAccount, previewRosa, reviewRosa } from './actions';
import { PreviewActions } from './preview-actions';
import { RosaReviewCard } from './review-card';

const statusLabels:Record<RosaDisposition,string>={'READY':'Ready to import','REVIEW REQUIRED':'Needs review','ERROR':'Error','EXISTING / NO CHANGE':'Already imported / No changes'};
type ChoiceKind='accountIds'|'userIds'|'skuIds'|'headerLines';
type AccountOptions={industries:{code:string;name:string}[];territories:{code:string;name:string}[]};
type Creating={groupKey:string;field:'Customer'|'VAR'|'End User';source:string};

export function RosaImportWorkflow({accountOptions}:{accountOptions:AccountOptions}){
  const [file,setFile]=useState<File|null>(null);
  const [plan,setPlan]=useState<RosaPlan|null>(null);
  const [choices,setChoices]=useState<RosaManualChoices>({});
  const [busy,setBusy]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [message,setMessage]=useState('');
  const [creating,setCreating]=useState<Creating|null>(null);
  const [createReview,setCreateReview]=useState<{matches:{id:number;name:string}[]}|null>(null);
  const [createErrors,setCreateErrors]=useState<Record<string,string>>({});
  const [createName,setCreateName]=useState('');
  const [createStatus,setCreateStatus]=useState('ACTIVE');
  const [createRole,setCreateRole]=useState('');
  const [createTerritory,setCreateTerritory]=useState('');
  const [createIndustry,setCreateIndustry]=useState('');
  const [duplicateAcknowledged,setDuplicateAcknowledged]=useState(false);
  function openCreate(groupKey:string,field:Creating['field'],source:string){setCreating({groupKey,field,source});setCreateName(source.trim());setCreateStatus('ACTIVE');setCreateRole(field==='Customer'?'DISTRIBUTOR':field==='VAR'?'VAR':'END_USER');setCreateTerritory('');setCreateIndustry('');setCreateReview(null);setCreateErrors({});setDuplicateAcknowledged(false)}
  function accountForm(){const data=new FormData();data.set('name',createName);data.set('status',createStatus);if(createRole)data.append('roles',createRole);data.set('territory',createTerritory);data.set('industry',createIndustry);return data}
  async function submitCreate(confirmed:boolean){if(!creating||!plan||!file||busy)return;setBusy(true);setCreateErrors({});setMessage('');try{const response=await createRosaAccount(form(),accountForm(),creating.groupKey,creating.field,choices,plan.digest,confirmed,duplicateAcknowledged);if(response.kind==='validation')setCreateErrors(response.errors);else if(response.kind==='review'){setCreateReview({matches:response.matches});setDuplicateAcknowledged(false)}else if(response.kind==='created'){setPlan(response.plan);setChoices(response.choices);setConfirmed(false);setCreating(null);setCreateReview(null);setMessage(`Account ${response.account.name} was created in the CRM and selected for ${creating.field}. The Price Exception still requires final import confirmation.`)}else setMessage(response.message)}catch{setMessage('Account could not be created. Review the form and try again.')}finally{setBusy(false)}}
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
    <section className="panel p-5"><h2 className="text-lg font-semibold">Upload CSV</h2><p className="mt-2 text-sm text-slate-600">Rows with the same PE Number become one Price Exception when their header details agree. Each quantity or SKU tier remains a separate pricing line. Approved maps to Active; original status and timestamps remain in metadata. The import itself creates no Accounts, Users, Products, or SKUs. You may separately create a CRM Account during review.</p><div className="mt-4 flex flex-wrap items-center gap-3"><ImportFileSelector ariaLabel="Price Exception CSV file" buttonText="Choose CSV File" accept=".csv,text/csv" filename={file?.name} onFileChange={selected=>{setFile(selected??null);setPlan(null);setChoices({});setConfirmed(false);setCreating(null)}}/><button className="btn-primary" disabled={!file||busy} onClick={()=>void preview()}>Preview Import</button></div></section>
    {message&&<p role="status" className="panel p-4 text-sm">{message}</p>}
    {plan&&<section className="panel p-5"><h2 className="text-lg font-semibold">2. Review {plan.groups.length} Price Exceptions from {plan.sourceRowCount} rows</h2><div className="mt-3 flex flex-wrap gap-3">{Object.entries(plan.counts).map(([status,count])=><span className="rounded bg-slate-100 px-3 py-2 text-sm" key={status}><strong>{count}</strong> {statusLabels[status as RosaDisposition]}</span>)}</div>{plan.errors.map(error=><p key={error} className="mt-2 text-red-800">{error}</p>)}<div className="mt-4 max-h-[650px] space-y-3 overflow-auto">{plan.groups.map(group=><RosaReviewCard key={group.groupKey} group={group} plan={plan} manual={choices[group.groupKey]} disabled={busy} onResolve={(groupKey,kind,field,value)=>void resolve(groupKey,kind,field,value)} onCreateAccount={openCreate}/>)}</div><PreviewActions plan={plan} confirmed={confirmed} busy={busy} onConfirm={setConfirmed} onApply={()=>void apply()}/></section>}
    {creating&&<div role="dialog" aria-modal="true" aria-labelledby="create-pe-account-title" onKeyDown={event=>{if(event.key==='Escape'&&!busy)setCreating(null)}} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-3"><div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl"><h2 id="create-pe-account-title" className="text-lg font-semibold">Create Account for {creating.field}</h2><p className="mt-1 break-words text-sm text-slate-600">Source: {creating.source}</p><p className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-900">Creating this Account will add it to the CRM immediately. The Price Exception will not be imported until you confirm the final import. The Account will remain if you leave this import.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2 text-sm font-medium">Account Name<input autoFocus className="field mt-1 w-full" value={createName} maxLength={200} onChange={event=>{setCreateName(event.target.value);setCreateReview(null)}}/>{createErrors.name&&<span className="block text-red-700">{createErrors.name}</span>}</label><label className="text-sm font-medium">Account Type / role<select className="field mt-1 w-full" value={createRole} onChange={event=>{setCreateRole(event.target.value);setCreateReview(null)}}><option value="">None</option><option value="DISTRIBUTOR">Distributor</option><option value="VAR">VAR / Reseller</option><option value="END_USER">End User</option><option value="ISV">ISV</option><option value="OEM">OEM</option><option value="PARTNER">Partner</option></select></label><label className="text-sm font-medium">Status<select className="field mt-1 w-full" value={createStatus} onChange={event=>{setCreateStatus(event.target.value);setCreateReview(null)}}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><label className="text-sm font-medium">Territory<select className="field mt-1 w-full" value={createTerritory} onChange={event=>{setCreateTerritory(event.target.value);setCreateReview(null)}}><option value="">None selected</option>{accountOptions.territories.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select>{createErrors.territory&&<span className="block text-red-700">{createErrors.territory}</span>}</label><label className="text-sm font-medium">Industry<select className="field mt-1 w-full" value={createIndustry} onChange={event=>{setCreateIndustry(event.target.value);setCreateReview(null)}}><option value="">None selected</option>{accountOptions.industries.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select>{createErrors.industry&&<span className="block text-red-700">{createErrors.industry}</span>}</label></div>{createErrors.status&&<p className="mt-2 text-sm text-red-700" role="alert">{createErrors.status}</p>}{createReview&&<div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm"><p className="font-semibold">{createReview.matches.length?'Likely duplicate Accounts found':'No likely duplicate Accounts found'}</p>{createReview.matches.length>0&&<><ul className="mt-2 space-y-1">{createReview.matches.map(match=><li className="break-words" key={match.id}>{match.name} · Account #{match.id} <button type="button" className="ml-2 text-orange-800 underline" onClick={()=>{void resolve(creating.groupKey,'accountIds',creating.field,match.id);setCreating(null)}}>Use existing</button></li>)}</ul><label className="mt-3 flex gap-2"><input type="checkbox" checked={duplicateAcknowledged} onChange={event=>setDuplicateAcknowledged(event.target.checked)}/><span>I reviewed these matches and still want a new Account.</span></label></>}</div>}<div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setCreating(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy||!createName.trim()||(!!createReview&&createReview.matches.length>0&&!duplicateAcknowledged)} onClick={()=>void submitCreate(!!createReview)}>{createReview?'Confirm Create Account':'Review Account creation'}</button></div></div></div>}
  </div>;
}
