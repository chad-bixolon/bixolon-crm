'use client';
import { submitPreservingForm, useResetOnSuccess } from '@/lib/submit-preserving-form';
import { useActionState, useRef, useState } from 'react';
import { submitProjectUpdate } from '@/app/project-update-actions';
import type { UpdateContext } from '@/lib/project-updates';
import { EntityPicker } from './entity-picker';

type Row = { id: number; body: string; projectId: number | null; opportunityId: number | null; createdAt: Date; updatedAt: Date; createdBy: { firstName: string; lastName: string } };
type Option = { id: number; name: string };

function UpdateForm({ context, update, options }: { context: UpdateContext; update?: Row; options: Option[] }) {
  const [state, action, pending] = useActionState(submitProjectUpdate.bind(null, context, update?.id ?? null), {});
  const formRef = useRef<HTMLFormElement>(null);
  useResetOnSuccess(state, state.saved && !update, formRef);
  const other = context.kind === 'project' ? 'opportunityId' : 'projectId';
  const current = update?.[other] ?? null;
  return <form ref={formRef} action={action} onSubmit={event => submitPreservingForm(event, action)} className="mt-3 space-y-3 rounded border border-slate-200 p-4">
    <label className="block text-sm font-medium" htmlFor={`update-body-${context.kind}-${update?.id ?? 'new'}`}>Update</label>
    <textarea id={`update-body-${context.kind}-${update?.id ?? 'new'}`} name="body" className="field min-h-28 w-full" maxLength={5000} required defaultValue={update?.body ?? ''}/>
    <EntityPicker type={context.kind === 'project' ? 'opportunity' : 'project'} label={`${context.kind === 'project' ? 'Linked Opportunity' : 'Linked Project'} (optional)`} name={other} initial={current ? { id: current, name: options.find(option => option.id === current)?.name ?? 'Linked record', context: null } : null} filters={context.kind === 'project' ? { projectId: context.id } : { opportunityId: context.id, editableOnly: true }}/>

    <div className="flex items-center gap-3"><button className="btn-primary" disabled={pending}>{pending ? 'Saving…' : update ? 'Save update' : 'Add update'}</button>{state.message && <span role={state.saved ? 'status' : 'alert'} className="text-sm">{state.message}</span>}</div>
  </form>;
}

export function ProjectUpdates({ context, rows, options, editable, editableIds }: { context: UpdateContext; rows: Row[]; options: Option[]; editable: boolean; editableIds: number[] }) {
  const [adding, setAdding] = useState(false);
  return <section className="panel min-w-0 p-6" aria-label="Project Updates">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 className="text-lg font-semibold">Project Updates ({rows.length})</h2>
      {editable && <button className="btn-primary" type="button" aria-expanded={adding} onClick={() => setAdding(open => !open)}>Add update</button>}
    </div>
    {editable && adding && <div className="text-sm"><UpdateForm context={context} options={options}/></div>}
    {rows.length ? <ul className="mt-4 divide-y">{rows.map(row => <li key={row.id} className="py-4"><p className="whitespace-pre-wrap text-sm">{row.body}</p><p className="mt-2 text-xs text-slate-500">{row.createdBy.firstName} {row.createdBy.lastName} · {row.createdAt.toISOString().slice(0, 10)}{row.updatedAt.getTime() !== row.createdAt.getTime() ? ' · edited' : ''}</p>{editableIds.includes(row.id) && <details className="mt-2 text-sm"><summary className="cursor-pointer text-orange-800">Edit update</summary><UpdateForm context={context} update={row} options={options}/></details>}</li>)}</ul> : <p className="mt-4 text-sm text-slate-500">No Project Updates yet.</p>}
  </section>;
}
