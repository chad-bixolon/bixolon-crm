'use client';
import { useActionState } from 'react';
import { changeSupportArchive } from '@/app/support/cases/actions';
export function SupportArchiveControl({ id, archived }: { id: number; archived: boolean }) {
  const [state, action, pending] = useActionState(changeSupportArchive.bind(null, id, !archived), {});
  return <form action={action} onSubmit={event => { if (!archived && !window.confirm('Archive this Support Case?')) event.preventDefault(); }}><button type="submit" className="btn-secondary" disabled={pending}>{pending ? 'Updating…' : archived ? 'Restore' : 'Archive'}</button>{state.message && <p role="status" className="text-sm text-slate-600">{state.message}</p>}</form>;
}
