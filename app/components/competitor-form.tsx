"use client";
import { useActionState } from "react";
import { submitCompetitor, type CompetitorState } from "@/app/administration/competitors/actions";

export function CompetitorForm({ initial }: { initial?: { id: number; name: string; active: boolean; sortOrder: number } }) {
  const [state, action, pending] = useActionState(submitCompetitor.bind(null, initial?.id ?? null), {} as CompetitorState);
  const prefix = `competitor-${initial?.id ?? "new"}`;
  return <form action={action} className="grid gap-3 sm:grid-cols-[minmax(10rem,2fr)_7rem_auto_auto] sm:items-end">
    <div><label className="label" htmlFor={`${prefix}-name`}>Name</label><input className="field" id={`${prefix}-name`} name="name" required maxLength={200} defaultValue={initial?.name ?? ""}/></div>
    <div><label className="label" htmlFor={`${prefix}-sort`}>Sort order</label><input className="field" id={`${prefix}-sort`} name="sortOrder" type="number" min={0} step={1} required defaultValue={initial?.sortOrder ?? 0}/></div>
    <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={initial?.active ?? true}/>Active</label>
    <button className="btn-secondary disabled:opacity-60" disabled={pending}>{pending ? "Saving…" : initial ? "Save" : "Add"}</button>
    {state.message && <p role="status" className={`text-sm sm:col-span-4 ${state.success ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
  </form>;
}
