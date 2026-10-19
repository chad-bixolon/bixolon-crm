'use client';
import { useEffect, useRef } from 'react';
export function RecordChangedNotice({ href, onReload, result }: { href: string; onReload?: () => void; result: unknown }) {
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => { notice.current?.focus(); }, [result]);
  return <div ref={notice} tabIndex={-1} role="alert" className="my-4 space-y-3 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-slate-900">
    <p>This record changed after you opened it. Review the latest version before saving again.</p>
    <p>Your entries are still in this form. Open the latest record to compare, then reload this form and re-enter the changes you want to save.</p>
    <div className="flex flex-wrap gap-3"><a className="btn-secondary" href={href} target="_blank" rel="noopener noreferrer">Review latest record</a><button className="btn-secondary" type="button" onClick={() => { if (window.confirm('Reload this form with the latest saved details? Copy any entries you want to keep first.')) { onReload?.(); window.location.reload(); } }}>Reload latest form</button></div>
  </div>;
}
