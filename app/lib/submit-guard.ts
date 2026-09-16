import { useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { submitGate } from './submit-gate';

// The ref closes the gap before React renders the action's pending state.
export function useSubmitGuard(result: unknown) {
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
    button.current = event.currentTarget.querySelector('button[type="submit"]');
    if (button.current) {
      button.current.disabled = true;
      button.current.textContent = 'Saving…';
    }
  };
}
