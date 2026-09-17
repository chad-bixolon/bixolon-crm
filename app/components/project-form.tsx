'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { ProjectPartyRole, ProjectStatus } from '@prisma/client';
import { submitProject, changeProjectArchive, type ProjectFormState } from '@/app/projects/actions';
import { projectRoleLabels, projectStatusLabels } from '@/lib/project-labels';
import { useSubmitGuard } from '@/lib/submit-guard';

type AccountOption = { id: number; name: string };
type OwnerOption = { id: number; firstName: string; lastName: string };
type Initial = { name: string; primaryAccountId: number; primaryAccountRole: ProjectPartyRole; ownerId: number | null;
  status: ProjectStatus; startDate: Date | null; targetEndDate: Date | null; description: string | null;
  participants: { accountId: number; roles: ProjectPartyRole[] }[] };
export function ProjectForm({ id, initial, accounts, owners, primaryAccountId: preselected }: {
  id?: number; initial?: Initial; accounts: AccountOption[]; owners: OwnerOption[]; primaryAccountId?: number;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitProject.bind(null, id ?? null), { errors: {} } as ProjectFormState);
  const guard = useSubmitGuard(state);
  const [primaryId, setPrimaryId] = useState(initial?.primaryAccountId ?? preselected ?? 0);
  const [participants, setParticipants] = useState(initial?.participants ?? []);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [participantMessage, setParticipantMessage] = useState('');
  useEffect(() => { if (state.redirectTo) router.push(state.redirectTo); }, [state.redirectTo, router]);
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  const accountOptions = [...accounts];
  const ownerOptions = [...owners];
  if (initial?.ownerId && !ownerOptions.some(o => o.id === initial.ownerId)) ownerOptions.push({ id: initial.ownerId, firstName: 'Current owner', lastName: '(inactive)' });
  for (const p of initial?.participants ?? []) if (!accountOptions.some(a => a.id === p.accountId)) accountOptions.push({ id: p.accountId, name: `Account #${p.accountId} (inactive)` });
  if (initial?.primaryAccountId && !accountOptions.some(a => a.id === initial.primaryAccountId)) accountOptions.push({ id: initial.primaryAccountId, name: `Account #${initial.primaryAccountId} (inactive)` });
  const available = accountOptions.filter(a => a.id !== primaryId && !participants.some(p => p.accountId === a.id));
  const add = () => { const accountId = Number(selectedAccount); if (!available.some(a => a.id === accountId)) { setParticipantMessage('Choose an available Account.'); return; }
    setParticipants(old => [...old, { accountId, roles: [] }]); setSelectedAccount(''); setParticipantMessage(''); };
  return <form action={action} onSubmit={guard} className="panel max-w-5xl space-y-7 p-6" aria-label={id ? 'Edit project' : 'Create project'}>
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <section className="grid gap-4 sm:grid-cols-2"><h2 className="sm:col-span-2 text-lg font-semibold">Overview</h2>
      <div className="sm:col-span-2"><label className="label" htmlFor="name">Project name *</label><input className="field" id="name" name="name" required maxLength={200} defaultValue={initial?.name ?? ''}/>{error('name')}</div>
      <div><label className="label" htmlFor="ownerId">Owner</label><select className="field" id="ownerId" name="ownerId" defaultValue={initial?.ownerId ?? ''}><option value="">Unassigned</option>{ownerOptions.map(o => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}</select>{error('ownerId')}</div>
      <div><label className="label" htmlFor="status">Status *</label><select className="field" id="status" name="status" defaultValue={initial?.status ?? 'PLANNING'}>{Object.entries(projectStatusLabels).map(([code,label]) => <option key={code} value={code}>{label}</option>)}</select>{error('status')}</div>
      <div><label className="label" htmlFor="startDate">Start date</label><input className="field" type="date" id="startDate" name="startDate" defaultValue={initial?.startDate?.toISOString().slice(0,10) ?? ''}/>{error('startDate')}</div>
      <div><label className="label" htmlFor="targetEndDate">Target end date</label><input className="field" type="date" id="targetEndDate" name="targetEndDate" defaultValue={initial?.targetEndDate?.toISOString().slice(0,10) ?? ''}/>{error('targetEndDate')}</div>
      <div className="sm:col-span-2"><label className="label" htmlFor="description">Description</label><textarea className="field min-h-28" id="description" name="description" maxLength={5000} defaultValue={initial?.description ?? ''}/>{error('description')}</div>
    </section>
    <section className="grid gap-4 rounded border border-orange-200 bg-orange-50/40 p-4 sm:grid-cols-2"><div className="sm:col-span-2"><h2 className="text-lg font-semibold">Primary Account</h2><p className="text-sm text-slate-600">The company primarily responsible for this Project. It is listed once, separately from additional participants.</p></div>
      <div><label className="label" htmlFor="primaryAccountId">Primary Account *</label><select className="field" id="primaryAccountId" name="primaryAccountId" required value={primaryId || ''} onChange={e => { const value = Number(e.target.value); setPrimaryId(value); setParticipants(old => old.filter(p => p.accountId !== value)); }}><option value="">Choose Account</option>{accountOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{error('primaryAccountId')}</div>
      <div><label className="label" htmlFor="primaryAccountRole">Primary Account Role *</label><select className="field" id="primaryAccountRole" name="primaryAccountRole" required defaultValue={initial?.primaryAccountRole ?? ''}><option value="">Choose role</option>{Object.entries(projectRoleLabels).map(([code,label]) => <option key={code} value={code}>{label}</option>)}</select>{error('primaryAccountRole')}</div>
    </section>
    <section><h2 className="text-lg font-semibold">Additional Participants</h2><p className="mb-4 text-sm text-slate-600">Optional participating Accounts. Give each one or more roles specific to this Project.</p>{error('participants')}
      <div className="mb-4 flex flex-wrap items-end gap-2"><div className="min-w-60 flex-1"><label className="label" htmlFor="addAccount">Account</label><select className="field" id="addAccount" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}><option value="">Choose Account</option>{available.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div><button type="button" className="btn-secondary" onClick={add}>Add Account</button></div>
      {participantMessage && <p role="alert" className="mb-3 text-sm text-red-700">{participantMessage}</p>}
      <div className="space-y-4">{participants.map(p => <div key={p.accountId} className="rounded border p-4"><div className="flex items-center justify-between gap-2"><strong>{accountOptions.find(a => a.id === p.accountId)?.name ?? `Account #${p.accountId}`}</strong><button type="button" className="btn-secondary" onClick={() => setParticipants(old => old.filter(item => item.accountId !== p.accountId))}>Remove</button></div><input type="hidden" name="accountId" value={p.accountId}/><input type="hidden" name="participantRoles" value={p.roles.join(',')}/><p className="mt-2 text-sm text-slate-600">Roles: {p.roles.map(role => projectRoleLabels[role]).join(', ') || 'Choose at least one'}</p><div className="mt-3 flex flex-wrap gap-3">{Object.entries(projectRoleLabels).map(([role,label]) => <label key={role} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={p.roles.includes(role as ProjectPartyRole)} onChange={e => setParticipants(old => old.map(item => item.accountId === p.accountId ? { ...item, roles: e.target.checked ? [...item.roles, role as ProjectPartyRole] : item.roles.filter(r => r !== role) } : item))}/>{label}</label>)}</div></div>)}</div>
    </section>
    <div className="flex justify-end gap-2"><Link className="btn-secondary" href={id ? `/projects/${id}` : '/projects'}>Cancel</Link><button type="submit" className="btn-primary" disabled={pending}>{pending ? 'Saving…' : id ? 'Save Project' : 'Create Project'}</button></div>
  </form>;
}
export function ProjectArchiveControl({ id, archived }: { id: number; archived: boolean }) {
  const [state, action, pending] = useActionState(changeProjectArchive.bind(null, id, !archived), { errors: {} } as ProjectFormState);
  return <form action={action}><button className="btn-secondary" disabled={pending}>{archived ? 'Reactivate Project' : 'Archive Project'}</button>{state.message && <span role="status" className="ml-3 text-sm">{state.message}</span>}</form>;
}
