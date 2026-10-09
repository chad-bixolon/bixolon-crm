import { startTransition, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { submitGate } from './submit-gate';

// The ref closes the gap before React renders the action's pending state.
export function useSubmitGuard(result: unknown, action?: (form: FormData) => void) {
  const gate = useRef(submitGate());
  const button = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    gate.current.release();
    if (button.current) button.current.disabled = false;
  }, [result]);
  return (event: FormEvent<HTMLFormElement>) => {
    if (!gate.current.claim()) {
      event.preventDefault();
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = action ? submitter instanceof HTMLElement && submitter.getAttribute('name')
      ? new FormData(event.currentTarget, submitter as HTMLButtonElement)
      : new FormData(event.currentTarget) : null;
    button.current = event.currentTarget.querySelector('button[type="submit"]');
    if (button.current) {
      button.current.disabled = true;
      button.current.textContent = 'Saving…';
    }
    if (action) {
      event.preventDefault();
      startTransition(() => action(form!));
    }
  };
}
