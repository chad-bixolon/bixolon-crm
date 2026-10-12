'use client';
import { startTransition, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { useRouter } from 'next/navigation';

type Props = Omit<ComponentProps<'form'>, 'action' | 'onSubmit'> & {
  action: (form: FormData) => Promise<unknown>;
  failureMessage?: string;
  refreshOnSuccess?: boolean;
};

export function RecoverableActionForm({ action, failureMessage = 'Could not save. Check the form and try again.', refreshOnSuccess = false, children, ...props }: Props) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  return <form {...props} aria-busy={pending} onSubmit={event => {
    event.preventDefault();
    if (busy.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = submitter instanceof HTMLElement && submitter.getAttribute('name')
      ? new FormData(event.currentTarget, submitter as HTMLButtonElement)
      : new FormData(event.currentTarget);
    busy.current = true;
    setPending(true);
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await action(form);
        if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') {
          setFeedback({ kind: 'error', message: result.error });
        } else if (result && typeof result === 'object' && 'success' in result && typeof result.success === 'string') {
          setFeedback({ kind: 'success', message: result.success });
          if (refreshOnSuccess) router.refresh();
        }
      }
      catch { setFeedback({ kind: 'error', message: failureMessage }); }
      finally { busy.current = false; setPending(false); }
    });
  }}>{children}{pending && <p role="status" className="mt-2 text-sm text-slate-600">Saving…</p>}{feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${feedback.kind === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>{feedback.message}</p>}</form>;
}
