'use client';
import { startTransition, useRef, useState } from 'react';
import type { ComponentProps } from 'react';

type Props = Omit<ComponentProps<'form'>, 'action' | 'onSubmit'> & {
  action: (form: FormData) => Promise<unknown>;
  failureMessage?: string;
};

export function RecoverableActionForm({ action, failureMessage = 'Could not save. Check the form and try again.', children, ...props }: Props) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <form {...props} aria-busy={pending} onSubmit={event => {
    event.preventDefault();
    if (busy.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = submitter instanceof HTMLElement && submitter.getAttribute('name')
      ? new FormData(event.currentTarget, submitter as HTMLButtonElement)
      : new FormData(event.currentTarget);
    busy.current = true;
    setPending(true);
    setError('');
    startTransition(async () => {
      try { const result = await action(form); if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') setError(result.error); }
      catch { setError(failureMessage); }
      finally { busy.current = false; setPending(false); }
    });
  }}>{children}{pending && <p role="status" className="mt-2 text-sm text-slate-600">Saving…</p>}{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</form>;
}
