"use client";
import { useActionState } from "react";
import { changeProjectOpportunity } from "@/app/projects/[id]/opportunity-actions";

export function ProjectOpportunityLinks({ projectId, linkedIds, options }: { projectId: number; linkedIds: number[]; options: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(changeProjectOpportunity.bind(null, projectId), {});
  const available = options.filter(option => !linkedIds.includes(option.id));
  return <form action={action} className="mt-4 flex flex-wrap items-end gap-2">
    <div className="min-w-60 flex-1"><label className="label" htmlFor="opportunityId">Existing Opportunity</label><select className="field" id="opportunityId" name="opportunityId" required><option value="">Choose Opportunity</option>{available.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div>
    <button className="btn-secondary" name="operation" value="link" disabled={pending || !available.length}>Link Opportunity</button>
    {state.message && <p className="w-full text-sm text-red-700" role="alert">{state.message}</p>}
  </form>;
}
