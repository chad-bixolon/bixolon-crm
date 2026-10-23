'use client';
import { useActionState } from 'react';
import { trustedDomainAction } from './actions';

export function AddDomainForm() {
  const [state, action, pending] = useActionState(trustedDomainAction, { message: '' });
  return <form action={action} className="panel mt-5 flex max-w-3xl flex-wrap items-end gap-3 p-5"><input type="hidden" name="action" value="add"/><label className="min-w-0 flex-1 text-sm font-medium" htmlFor="domain">Add trusted domain<input id="domain" className="field mt-1" name="domain" placeholder="example.com" autoComplete="off" required/></label><button disabled={pending} className="btn-primary">Add domain</button>{state.message && <p role="status" className="w-full text-sm">{state.message}</p>}</form>;
}
export function DomainActionForm({ domain, active, own }: { domain: string; active: boolean; own: boolean }) {
  const [state, action, pending] = useActionState(trustedDomainAction, { message: '' });
  return <form action={action} className="flex flex-wrap items-center gap-2"><input type="hidden" name="domain" value={domain}/><input type="hidden" name="action" value={active ? 'deactivate' : 'activate'}/>{active && own && <label className="w-full text-sm text-amber-800"><input type="checkbox" name="confirmOwnDomain" value="yes" className="mr-2"/>This is your current sign-in domain. Deactivating it may end your access.</label>}<button className="btn-secondary" disabled={pending}>{active ? 'Deactivate' : 'Activate'}</button>{state.message && <p role="status" className="w-full text-sm">{state.message}</p>}</form>;
}
