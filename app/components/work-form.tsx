'use client';
import { useActionState } from 'react';
import { submitTask, archiveTask, reactivateTask, type WorkState } from '@/app/tasks/actions';
import { submitActivity } from '@/app/activities/actions';
import { submitNote, archiveNote, reactivateNote } from '@/app/notes/actions';
import { useSubmitGuard } from '@/lib/submit-guard';
type Option = { id: number; name: string };
type Props = { kind: 'task'|'activity'|'note'; id?: number; createKey?: string; initial?: Record<string, string | number | null>; accounts: Option[]; opportunities: Option[]; projects: Option[]; users: Option[]; activityTypes?: { code: string; name: string }[]; lockAccountId?: number; lockOpportunityId?: number; lockProjectId?: number };
export function WorkForm({ kind, id, createKey, initial = {}, accounts, opportunities, projects, users, activityTypes = [], lockAccountId, lockOpportunityId, lockProjectId }: Props) {
  const handler = kind === 'task' ? submitTask : kind === 'activity' ? submitActivity : submitNote;
  const [state, action, pending] = useActionState(handler.bind(null, id ?? null), { errors: {} } as WorkState);
  const guard = useSubmitGuard(state);
  const val = (key: string) => String(initial[key] ?? '');
  const select = (key: string, label: string, options: { value: string; label: string }[], empty = 'None') => <div><label className="label" htmlFor={key}>{label}</label><select className="field" id={key} name={key} defaultValue={val(key)}><option value="">{empty}</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{state.errors[key] && <p className="text-sm text-red-700">{state.errors[key]}</p>}</div>;
  const records = (items: Option[]) => items.map(o => ({ value: String(o.id), label: o.name }));
  const projectOptions = [...projects];
  const currentProjectId = Number(val('projectId'));
  if (currentProjectId && !projectOptions.some(p => p.id === currentProjectId)) projectOptions.push({ id: currentProjectId, name: `Current Project #${currentProjectId} (archived)` });
  return <><form action={action} onSubmit={guard} className="panel grid gap-4 p-6 sm:grid-cols-2">
    {createKey && !id && <input type="hidden" name="createKey" value={createKey}/>}
    {kind !== 'note' && <div className="sm:col-span-2"><label className="label" htmlFor="subject">Subject</label><input className="field" id="subject" name="subject" defaultValue={val('subject')} required maxLength={200}/>{state.errors.subject && <p className="text-sm text-red-700">{state.errors.subject}</p>}</div>}
    {kind === 'note' ? <div className="sm:col-span-2"><label className="label" htmlFor="body">Note</label><textarea className="field min-h-32" id="body" name="body" defaultValue={val('body')} required maxLength={10000}/>{state.errors.body && <p className="text-sm text-red-700">{state.errors.body}</p>}</div> : <div className="sm:col-span-2"><label className="label" htmlFor="description">Description</label><textarea className="field min-h-24" id="description" name="description" defaultValue={val('description')} maxLength={5000}/></div>}
    {lockAccountId ? <input type="hidden" name="accountId" value={lockAccountId}/> : select('accountId','Account',records(accounts))}
    {lockOpportunityId ? <input type="hidden" name="opportunityId" value={lockOpportunityId}/> : select('opportunityId','Opportunity',records(opportunities))}
    {lockProjectId ? <input type="hidden" name="projectId" value={lockProjectId}/> : select('projectId','Project',records(projectOptions))}
    {kind === 'task' && <>{select('assignedToId','Assignee',records(users))}{select('status','Status',['OPEN','IN_PROGRESS','COMPLETED','CANCELLED'].map(x => ({value:x,label:x.replace('_',' ')})),'Choose status')}{select('priority','Priority',['LOW','NORMAL','HIGH','URGENT'].map(x => ({value:x,label:x})),'Choose priority')}<div><label className="label" htmlFor="dueDate">Due date</label><input className="field" type="date" id="dueDate" name="dueDate" defaultValue={val('dueDate')}/></div></>}
    {kind === 'activity' && <>{select('type','Activity type',activityTypes.map(x => ({value:x.code,label:x.name})),'Choose type')}{select('userId','Responsible user',records(users))}<div><label className="label" htmlFor="activityDate">Activity date</label><input className="field" type="date" id="activityDate" name="activityDate" defaultValue={val('activityDate')} required/></div></>}
    {kind === 'note' && !id && select('createdById','Author',records(users))}
    <div className="sm:col-span-2"><button type="submit" className="btn-primary" disabled={pending}>{pending ? 'Saving…' : id ? 'Save changes' : `Create ${kind}`}</button>{state.message && <p role="status" className="mt-2 text-sm text-red-700">{state.message}</p>}</div>
  </form>{id && kind !== 'activity' && <ArchiveWork kind={kind} id={id}/>}</>;
}
function ArchiveWork({kind,id}: {kind:'task'|'note';id:number}) { const [state,action,pending] = useActionState((kind === 'task' ? archiveTask : archiveNote).bind(null,id),{errors:{}} as WorkState); return <form action={action} className="mt-5"><button className="btn-secondary" disabled={pending}>{pending ? 'Archiving…' : `Archive ${kind}`}</button>{state.message && <span className="ml-3 text-sm">{state.message}</span>}</form>; }
export function ReactivateTask({id}:{id:number}) { const [state,action,pending]=useActionState(reactivateTask.bind(null,id),{errors:{}} as WorkState); return <form action={action}><button className="btn-primary" disabled={pending}>{pending ? 'Reactivating…' : 'Reactivate task'}</button>{state.message && <span role="status" className="ml-3 text-sm">{state.message}</span>}</form>; }
export function ReactivateNote({id}:{id:number}) { const [state,action,pending]=useActionState(reactivateNote.bind(null,id),{errors:{}} as WorkState); return <form action={action}><button className="btn-primary" disabled={pending}>{pending ? 'Reactivating…' : 'Reactivate note'}</button>{state.message && <span role="status" className="ml-3 text-sm">{state.message}</span>}</form>; }
