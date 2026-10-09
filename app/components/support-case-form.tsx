'use client';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useSubmitGuard } from '@/lib/submit-guard';
import type { SupportCasePriority, SupportCaseSource, SupportCaseStatus } from '@prisma/client';
import { saveSupportCase } from '@/app/support/cases/actions';
import { SupportCasePicker } from './support-case-picker';
import { supportPriorityLabels, supportSourceLabels, supportStatusLabels } from '@/lib/support-cases';

type Option = { id: number; name: string; active?: boolean };
type Case = { id: number; account: Option | null; customerNameText: string | null; purchasedFromAccount: Option | null; purchaseSourceText: string | null; contact: { id: number; firstName: string; lastName: string } | null; productSku: { id: number; partNumber: string } | null; assignedTo: { id: number; firstName: string; lastName: string } | null; accountId: number | null; subject: string; description: string; status: SupportCaseStatus; priority: SupportCasePriority; source: SupportCaseSource; categoryId: number | null; assignedToId: number | null; serialNumber: string | null; nextFollowUpAt: string | null; resolutionSummary: string | null };
export function SupportCaseForm({ initial, categories, assignees, defaultAssigneeId, zone }: { initial?: Case; categories: Option[]; assignees: Option[]; defaultAssigneeId: number | null; zone: string }) {
  const [state, action, pending] = useActionState(saveSupportCase.bind(null, initial?.id ?? null), {});
  const guard = useSubmitGuard(state, action);
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? null);
  const [status, setStatus] = useState<SupportCaseStatus>(initial?.status ?? 'NEW');
  const needsResolution = status === 'RESOLVED' || status === 'CLOSED';
  const categoryOptions = categories.filter(c => c.active || c.id === initial?.categoryId);
  const assigneeOptions = initial?.assignedTo && !assignees.some(a => a.id === initial.assignedToId) ? [...assignees, { id: initial.assignedTo.id, name: `${initial.assignedTo.firstName} ${initial.assignedTo.lastName} (historical)` }] : assignees;
  return <form onSubmit={guard} className="panel space-y-6 p-5">
    <div className="grid gap-4 md:grid-cols-2"><label className="label">Customer / End User<input className="field mt-1" name="customerNameText" maxLength={500} defaultValue={initial?.customerNameText ?? ''} aria-invalid={state.field === 'customerNameText'}/><span className="mt-1 block font-normal text-slate-600">Enter the end user or company requesting support.</span>{state.field === 'customerNameText' && <span role="alert" className="text-sm text-red-700">{state.message}</span>}</label><div><SupportCasePicker kind="account" name="accountId" label="Linked CRM Account (optional)" initial={initial?.account} onPick={setAccountId} error={state.field === 'accountId' ? state.message : undefined}/><p className="mt-1 text-sm text-slate-600">Link the customer to an existing SalesHub Account when available.</p></div><SupportCasePicker key={accountId ?? 'none'} kind="contact" name="contactId" label="Contact" accountId={accountId} initial={accountId === initial?.accountId && initial?.contact ? { id: initial.contact.id, name: `${initial.contact.firstName} ${initial.contact.lastName}` } : null} error={state.field === 'contactId' ? state.message : undefined}/>
      <label className="label">Subject<input className="field mt-1" name="subject" required maxLength={300} defaultValue={initial?.subject}/></label>
      <label className="label">Source<select className="field mt-1" name="source" required defaultValue={initial?.source ?? ''}><option value="">Choose source</option>{Object.entries(supportSourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{state.field === 'source' && <span role="alert" className="text-sm text-red-700">{state.message}</span>}</label>
      <label className="label">Status<select className="field mt-1" name="status" value={status} onChange={event => setStatus(event.target.value as SupportCaseStatus)}>{Object.entries(supportStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label" style={!initial && !needsResolution ? { display: 'none' } : undefined}>Resolution Summary{needsResolution && <span className="ml-1 text-red-700">*</span>}<textarea className="field mt-1 min-h-24" name="resolutionSummary" aria-required={needsResolution} aria-invalid={state.field === 'resolutionSummary'} maxLength={20000} defaultValue={initial?.resolutionSummary ?? ''}/>{needsResolution && <span className="mt-1 block font-normal text-slate-600">Describe how the issue was resolved.</span>}{state.field === 'resolutionSummary' && <span role="alert" className="text-sm text-red-700">{state.message}</span>}</label>
      <label className="label">Priority<select className="field mt-1" name="priority" defaultValue={initial?.priority ?? 'NORMAL'}>{Object.entries(supportPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">Category<select className="field mt-1" name="categoryId" defaultValue={initial?.categoryId ?? ''}><option value="">None</option>{categoryOptions.map(c => <option key={c.id} value={c.id}>{c.name}{!c.active ? ' (inactive)' : ''}</option>)}</select></label>
      <label className="label">Assigned Support Rep<select className="field mt-1" name="assignedToId" defaultValue={initial ? initial.assignedToId ?? '' : defaultAssigneeId ?? ''}><option value="">Unassigned</option>{assigneeOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{state.field === 'assignedToId' && <span role="alert" className="text-sm text-red-700">{state.message}</span>}</label>
      <SupportCasePicker kind="sku" name="productSkuId" label="Product / SKU" initial={initial?.productSku ? { id: initial.productSku.id, name: initial.productSku.partNumber } : null} error={state.field === 'productSkuId' ? state.message : undefined}/>
      <label className="label">Serial Number<input className="field mt-1" name="serialNumber" maxLength={300} defaultValue={initial?.serialNumber ?? ''}/></label>
      <label className="label">Next Follow-up <span className="font-normal text-slate-500">({zone})</span><input className="field mt-1" type="datetime-local" name="nextFollowUpAt" defaultValue={initial?.nextFollowUpAt ?? ''}/>{needsResolution && !initial && <span className="mt-1 block font-normal text-slate-600">Follow-up is cleared when creating a resolved or closed case.</span>}{state.field === 'nextFollowUpAt' && <span role="alert" className="text-sm text-red-700">{state.message}</span>}</label>
    </div>
    <section className="space-y-3 border-t border-slate-200 pt-5" aria-label="Purchase source">
      <label className="label">Purchased From<input className="field mt-1" name="purchaseSourceText" maxLength={500} defaultValue={initial?.purchaseSourceText ?? ''}/><span className="mt-1 block font-normal text-slate-600">Reseller, distributor, retailer, or other source where the end user purchased the equipment.</span></label>
      <div><SupportCasePicker kind="account" name="purchasedFromAccountId" label="Link to CRM Account (optional)" initial={initial?.purchasedFromAccount} error={state.field === "purchasedFromAccountId" ? state.message : undefined}/><p className="mt-1 text-sm text-slate-600">Use this when the reseller or distributor already exists in SalesHub.</p></div>
    </section>
    <label className="label">Description<textarea className="field mt-1 min-h-36" name="description" required maxLength={20000} defaultValue={initial?.description}/></label>
    {state.message && !state.field && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
    <div className="form-action-row"><button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Create case'}</button><Link className="btn-secondary" href={initial ? `/support/cases/${initial.id}` : '/support/cases'}>Cancel</Link></div>
  </form>;
}
