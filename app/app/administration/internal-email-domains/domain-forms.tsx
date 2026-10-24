'use client';
import { useActionState } from 'react';
import { internalEmailDomainAction } from './actions';

export function AddInternalDomainForm() {
  const [state, action, pending] = useActionState(internalEmailDomainAction, { message: '' });
  return <form action={action} className="panel mt-5 flex max-w-3xl flex-wrap items-end gap-3 p-5"><input type="hidden" name="action" value="add"/><label className="min-w-0 flex-1 text-sm font-medium" htmlFor="internal-domain">Add Internal Email Domain<input id="internal-domain" className="field mt-1" name="domain" placeholder="acme.com" autoComplete="off" required/></label><button disabled={pending} className="btn-primary">Add domain</button>{state.message && <p role="status" className="w-full text-sm">{state.message}</p>}</form>;
}
export function InternalDomainActionForm({ domain, active }: { domain: string; active: boolean }) {
  const [state, action, pending] = useActionState(internalEmailDomainAction, { message: '' });
  return <form action={action} className="flex flex-wrap items-center gap-2"><input type="hidden" name="domain" value={domain}/><input type="hidden" name="action" value={active ? 'deactivate' : 'activate'}/><button className="btn-secondary" disabled={pending}>{active ? 'Deactivate' : 'Reactivate'}</button>{state.message && <p role="status" className="w-full text-sm">{state.message}</p>}</form>;
}
