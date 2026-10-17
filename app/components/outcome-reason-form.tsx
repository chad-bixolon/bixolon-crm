"use client";
import { submitPreservingForm, useResetOnSuccess } from '@/lib/submit-preserving-form';
import { useActionState, useRef } from "react";
import { submitOutcomeReason, type OutcomeReasonState } from "@/app/administration/outcome-reasons/actions";

export function OutcomeReasonForm({ initial }: { initial?: { id: number; name: string; active: boolean; sortOrder: number; isWon: boolean } }) {
  const [state, action, pending] = useActionState(submitOutcomeReason.bind(null, initial?.id ?? null), {} as OutcomeReasonState);
  const formRef = useRef<HTMLFormElement>(null);
  useResetOnSuccess(state, state.success && !initial, formRef);
  const prefix = `outcomeReason-${initial?.id ?? "new"}`;
  return <form ref={formRef} action={action} onSubmit={event => submitPreservingForm(event, action)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(10rem,2fr)_10rem_7rem_auto_auto] sm:items-end">
    <div><label className="label" htmlFor={`${prefix}-name`}>Name</label><input className="field" id={`${prefix}-name`} name="name" required maxLength={200} defaultValue={initial?.name ?? ""}/></div>
    <div><label className="label" htmlFor={`${prefix}-status`}>Close state</label>{initial ? <><input type="hidden" name="status" value={initial.isWon ? 'won' : 'lost'}/><p className="py-2 text-sm">Closed {initial.isWon ? 'Won' : 'Lost'}</p></> : <select className="field" id={`${prefix}-status`} name="status"><option value="lost">Closed Lost</option><option value="won">Closed Won</option></select>}</div>
    <div><label className="label" htmlFor={`${prefix}-sort`}>Sort order</label><input className="field" id={`${prefix}-sort`} name="sortOrder" type="number" min={0} step={1} required defaultValue={initial?.sortOrder ?? 0}/></div>
    <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={initial?.active ?? true}/>Active</label>
    <button className="btn-secondary disabled:opacity-60" disabled={pending}>{pending ? "Saving…" : initial ? "Save" : "Add"}</button>
    {state.message && <p role="status" className={`text-sm sm:col-span-2 xl:col-span-5 ${state.success ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
  </form>;
}
