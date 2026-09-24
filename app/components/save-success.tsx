'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';

const subscribeToLocation = () => () => {};
export function useQueryValue(name: string) {
  return useSyncExternalStore(subscribeToLocation, () => new URL(window.location.href).searchParams.get(name), () => null);
}

export function SaveSuccess({ message, action }: { message: string; action?: { href: string; label: string } }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('saved');
    url.searchParams.delete('savedId');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    const timer = window.setTimeout(() => setVisible(false), 7000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return <div className="save-success" role="status" aria-live="polite">
    <span aria-hidden="true" className="save-success-icon">✓</span>
    <p className="min-w-0 flex-1 font-medium">{message}</p>
    {action && <Link className="save-success-action" href={action.href}>{action.label}</Link>}
    <button className="save-success-dismiss" type="button" onClick={() => setVisible(false)} aria-label="Dismiss success message">×</button>
  </div>;
}

export function SaveSuccessFromQuery({ recordName }: { recordName: string }) {
  const outcome = useQueryValue('saved');
  const message = outcome === 'created' ? `${recordName} created successfully.` : outcome === 'updated' ? 'Changes saved.' : null;
  return message ? <SaveSuccess message={message}/> : null;
}
