'use client';

import Link from 'next/link';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import type { UserRole } from '@prisma/client';
import { roleLabels } from '@/lib/role-labels';
import { signOutAction } from '@/app/sign-out-action';
import { useDismissOnOutside } from './use-dismiss-on-outside';

export function UserAccountMenu({ name, role }: { name: string; role: UserRole }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const dismiss = useCallback(() => {
    if (container.current?.contains(document.activeElement)) trigger.current?.focus();
    setOpen(false);
  }, []);
  useDismissOnOutside(open, container, dismiss);
  const navigate = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const key = event.key;
    setOpen(true);
    requestAnimationFrame(() => {
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button') ?? [])];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next = 0;
      if (key === 'End') next = items.length - 1;
      else if (key === 'ArrowDown') next = (index + 1) % items.length;
      else if (key === 'ArrowUp') next = (index < 0 ? items.length - 1 : (index + items.length - 1) % items.length);
      items[next]?.focus();
    });
  };
  const itemClass = 'flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-600';
  return <div ref={container} className="relative min-w-0 shrink-0" onKeyDown={navigate} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label={`User account: ${name}, ${roleLabels[role]}`} aria-expanded={open} aria-controls="user-account-menu" onClick={() => setOpen(value => !value)} className="flex min-h-11 max-w-20 items-center gap-1 rounded-md px-1 text-right hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-orange-600 max-[360px]:max-w-12 sm:max-w-44 sm:gap-2 sm:px-2 lg:max-w-56" title={`${name} · ${roleLabels[role]}`}>
      <span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-900 sm:text-sm">{name}</span><span className="block truncate text-[10px] text-slate-500 sm:text-xs">{roleLabels[role]}</span></span>
      <svg aria-hidden="true" className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 6 4 4 4-4"/></svg>
    </button>
    {open && <nav ref={panel} id="user-account-menu" aria-label="User account" className="absolute right-0 z-50 mt-2 w-48 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
      <Link href="/my-integrations" onClick={() => setOpen(false)} className={itemClass}>My integrations</Link>
      <form action={signOutAction} onSubmit={() => setOpen(false)}><button type="submit" className={itemClass}>Sign out</button></form>
    </nav>}
  </div>;
}
