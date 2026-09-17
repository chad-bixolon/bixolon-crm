"use client";
import { useActionState } from "react";
import { submitStage } from "@/app/administration/sales-stages/actions";
type Stage = { id: number; name: string; probability: number; sortOrder: number; active: boolean; isClosed: boolean; isWon: boolean };
export function StageForm({ stage }: { stage?: Stage }) {
  const [state, action, pending] = useActionState(submitStage.bind(null, stage?.id ?? null), { message: "", success: false });
  return <form action={action} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7 lg:items-end">
    <label className="label lg:col-span-2">Name<input className="field" name="name" required maxLength={200} defaultValue={stage?.name}/></label>
    <label className="label">Probability %<input className="field" name="probability" type="number" min={0} max={100} required defaultValue={stage?.probability ?? 0}/></label>
    <label className="label">Sort order<input className="field" name="sortOrder" type="number" min={0} required defaultValue={stage?.sortOrder ?? 0}/></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={stage?.active ?? true}/>Active</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isClosed" defaultChecked={stage?.isClosed ?? false}/>Closed</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isWon" defaultChecked={stage?.isWon ?? false}/>Won</label>
    <button className="btn-secondary lg:col-span-7" disabled={pending}>{pending ? "Saving…" : stage ? "Save stage" : "Add stage"}</button>
    {state.message && <p role="status" className={`text-sm lg:col-span-7 ${state.success ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
  </form>;
}
