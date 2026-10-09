import { startTransition, useEffect } from 'react';
import type { FormEvent, RefObject } from 'react';

// Dispatching an action outside React's form action machinery keeps uncontrolled
// controls intact when the action returns a validation error. Native validation
// still runs before onSubmit, and successful actions keep their existing UX.
export function submitPreservingForm(event: FormEvent<HTMLFormElement>, action: (form: FormData) => void) {
  event.preventDefault();
  const submitter = (event.nativeEvent as SubmitEvent).submitter;
  const form = submitter instanceof HTMLElement && submitter.getAttribute('name')
    ? new FormData(event.currentTarget, submitter as HTMLButtonElement)
    : new FormData(event.currentTarget);
  startTransition(() => action(form));
}

export function useResetOnSuccess(result: unknown, success: boolean | undefined, formRef: RefObject<HTMLFormElement | null>) {
  useEffect(() => { if (success) formRef.current?.reset(); }, [result, success, formRef]);
}
