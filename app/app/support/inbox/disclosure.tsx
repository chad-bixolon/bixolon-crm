'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function InboxDisclosure({ label, children, summary, className = '', panelClassName = '', buttonClassName = 'rounded px-1 py-2 text-xs font-medium text-slate-600 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-orange-600' }: { label: string; children: ReactNode; summary?: ReactNode; className?: string; panelClassName?: string; buttonClassName?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && root.current?.contains(document.activeElement)) {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <div ref={root} className={className}>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      {summary}
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={id} className={buttonClassName} onClick={() => setOpen(value => !value)}>{label}<span aria-hidden="true" className="ml-1">{open ? '−' : '+'}</span></button>
    </div>
    <div id={id} hidden={!open} className={panelClassName}>{children}</div>
  </div>;
}
