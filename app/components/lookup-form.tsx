"use client";
import { useActionState } from "react";
import { submitLookup, type LookupState } from "@/app/administration/lookups/[kind]/actions";
import type { LookupKind, LookupInput } from "@/lib/lookups";

export function LookupForm({ kind, initial }: { kind: LookupKind; initial?: LookupInput }) {
  const [state, action, pending] = useActionState(submitLookup.bind(null, kind, !!initial), { errors: {} } as LookupState);
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  return <form action={action} className="grid gap-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(10rem,2fr)_7rem_auto_auto] sm:items-end">
    <div><label className="label" htmlFor={`${kind}-${initial?.code ?? "new"}-code`}>Code</label><input className="field" id={`${kind}-${initial?.code ?? "new"}-code`} name="code" required maxLength={100} readOnly={!!initial} defaultValue={initial?.code ?? ""}/>{error("code")}</div>
    <div><label className="label" htmlFor={`${kind}-${initial?.code ?? "new"}-name`}>Name</label><input className="field" id={`${kind}-${initial?.code ?? "new"}-name`} name="name" required maxLength={200} defaultValue={initial?.name ?? ""}/>{error("name")}</div>
    <div><label className="label" htmlFor={`${kind}-${initial?.code ?? "new"}-sort`}>Sort order</label><input className="field" id={`${kind}-${initial?.code ?? "new"}-sort`} name="sortOrder" type="number" min={0} step={1} required defaultValue={initial?.sortOrder ?? 0}/>{error("sortOrder")}</div>
    <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={initial?.active ?? true}/>Active</label>
    <button className="btn-secondary disabled:opacity-60" disabled={pending}>{pending ? "Saving…" : initial ? "Save" : "Add"}</button>
    {state.message && <p role="status" className={`text-sm sm:col-span-5 ${state.success ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
  </form>;
}
