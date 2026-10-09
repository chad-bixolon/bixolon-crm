"use client";
import { submitPreservingForm } from '@/lib/submit-preserving-form';
import { useActionState } from "react";
import { changeProjectOpportunity } from "@/app/projects/[id]/opportunity-actions";
import { EntityPicker } from './entity-picker';

export function ProjectOpportunityLinks({ projectId }: { projectId: number }) {
  const [state, action, pending] = useActionState(changeProjectOpportunity.bind(null, projectId), {});
  return <form action={action} onSubmit={event => submitPreservingForm(event, action)} className="mt-4 flex flex-wrap items-end gap-2">
    <div className="min-w-60 flex-1"><EntityPicker type="opportunity" label="Existing Opportunity" name="opportunityId" filters={{ excludeProjectId: projectId }} required/></div>
    <button className="btn-secondary" name="operation" value="link" disabled={pending}>Link Opportunity</button>
    {state.message && <p className="w-full text-sm text-red-700" role="alert">{state.message}</p>}
  </form>;
}
