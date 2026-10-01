'use client';
import { useActionState } from 'react';
import { submitProjectUpdate } from '@/app/project-update-actions';
import type { UpdateContext } from '@/lib/project-updates';

type Row = { id: number; body: string; projectId: number | null; opportunityId: number | null; createdAt: Date; updatedAt: Date; createdBy: { firstName: string; lastName: string } };
type Option = { id: number; name: string };

function UpdateForm({ context, update, options }: { context: UpdateContext; update?: Row; options: Option[] }) {
  const [state, action, pending] = useActionState(submitProjectUpdate.bind(null, context, update?.id ?? null), {});
  const other = context.kind === 'project' ? 'opportunityId' : 'projectId';
  const current = update?.[other] ?? null;
  return <form action={action} className="mt-3 space-y-3 rounded border border-slate-200 p-4">
    <label className="block text-sm font-medium" htmlFor={`update-body-${context.kind}-${update?.id ?? 'new'}`}>Update</label>
    <textarea id={`update-body-${context.kind}-${update?.id ?? 'new'}`} name="body" className="field min-h-28 w-full" maxLength={5000} required defaultValue={update?.body ?? ''}/>
    <label className="block text-sm font-medium" htmlFor={`update-other-${context.kind}-${update?.id ?? 'new'}`}>{context.kind === 'project' ? 'Linked Opportunity' : 'Linked Project'} (optional)</label>
    <select id={`update-other-${context.kind}-${update?.id ?? 'new'}`} name={other} className="field w-full" defaultValue={current ?? ''}>
      <option value="">None</option>
      {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      {current && !options.some(option => option.id === current) && <option value={current}>Linked record #{current}</option>}
    </select>
    <div className="flex items-center gap-3"><button className="btn-primary" disabled={pending}>{pending ? 'Saving…' : update ? 'Save update' : 'Add update'}</button>{state.message && <span role={state.saved ? 'status' : 'alert'} className="text-sm">{state.message}</span>}</div>
  </form>;
}

export function ProjectUpdates({ context, rows, options, editable, editableIds }: { context: UpdateContext; rows: Row[]; options: Option[]; editable: boolean; editableIds: number[] }) {
  return <section className="panel p-6" aria-label="Project Updates">
    <h2 className="text-lg font-semibold">Project Updates ({rows.length})</h2>
    {editable && <details className="mt-4 text-sm"><summary className="btn-primary inline-block cursor-pointer">Add update</summary><UpdateForm context={context} options={options}/></details>}
    {rows.length ? <ul className="mt-4 divide-y">{rows.map(row => <li key={row.id} className="py-4"><p className="whitespace-pre-wrap text-sm">{row.body}</p><p className="mt-2 text-xs text-slate-500">{row.createdBy.firstName} {row.createdBy.lastName} · {row.createdAt.toISOString().slice(0, 10)}{row.updatedAt.getTime() !== row.createdAt.getTime() ? ' · edited' : ''}</p>{editableIds.includes(row.id) && <details className="mt-2 text-sm"><summary className="cursor-pointer text-orange-800">Edit update</summary><UpdateForm context={context} update={row} options={options}/></details>}</li>)}</ul> : <p className="mt-4 text-sm text-slate-500">No Project Updates yet.</p>}
  </section>;
}
