'use client';
import { useActionState } from 'react';
import { resetGoogleIdentity, type FormState } from '@/app/administration/users/actions';

export function GoogleIdentityReset({ userId, identityId, email }: { userId: number; identityId: number; email: string }) {
  const [state, action, pending] = useActionState(resetGoogleIdentity.bind(null, userId, identityId), { errors: {} } as FormState);
  return <form action={action} onSubmit={event => { if (!window.confirm(`Unlink Google sign-in for ${email}? Existing sessions will stop working.`)) event.preventDefault(); }} className="mt-5 space-y-3 border-t pt-5">
    <p className="text-sm text-slate-600">For account recovery only. Existing sessions will be revoked. The next approved Google sign-in can link this CRM user again.</p>
    <label className="label" htmlFor="confirmEmail">Type {email} to confirm</label>
    <input className="field max-w-md" id="confirmEmail" name="confirmEmail" type="email" autoComplete="off" required/>
    <div><button className="btn-secondary" disabled={pending}>{pending ? 'Unlinking…' : 'Unlink Google identity'}</button></div>
    {state.message && <p role="status" className="text-sm text-slate-700">{state.message}</p>}
  </form>;
}
