'use client';
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { RecentItemView } from '@/lib/recent-items';
import { useDismissOnOutside } from './use-dismiss-on-outside';

export function RecentItems() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentItemView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [placement, setPlacement] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const dismiss = useCallback(() => {
    if (container.current?.contains(document.activeElement)) trigger.current?.focus();
    setOpen(false);
  }, []);
  useDismissOnOutside(open, container, dismiss);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(window.innerWidth < 640 ? window.innerWidth - 32 : 352, window.innerWidth - 32);
      const top = Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 80));
      const left = window.innerWidth < 640 ? 16 : Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
      setPlacement({ top, left, width, maxHeight: window.innerHeight - top - 16 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let controller: AbortController;
    const load = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      void fetch('/api/recent-items', { cache: 'no-store', signal: request.signal }).then(async response => {
        if (!response.ok) throw new Error('Recent items unavailable');
        const data = await response.json() as { items: RecentItemView[] };
        if (!request.signal.aborted) { setItems(data.items); setFailed(false); }
      }).catch(() => { if (!request.signal.aborted) setFailed(true); });
    };
    load();
    window.addEventListener('saleshub:recent-viewed', load);
    return () => { controller.abort(); window.removeEventListener('saleshub:recent-viewed', load); };
  }, [open, pathname]);
  return <div ref={container} className="relative shrink-0">
    <button ref={trigger} type="button" title="Recent Items" aria-label="Recent Items" aria-expanded={open} aria-controls="recent-items-panel" className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-orange-600" onClick={() => { setItems(null); setFailed(false); setOpen(value => !value); }}>
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/></svg>
    </button>
    {open && placement && <section id="recent-items-panel" aria-label="Recent Items" style={placement} className="fixed z-50 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
      <h2 className="border-b px-4 py-3 text-sm font-semibold">Recent Items</h2>
      {failed ? <p role="status" className="p-4 text-sm text-slate-600">Recent items are unavailable. Close and reopen to try again.</p> : items === null ? <p role="status" className="p-4 text-sm text-slate-600">Loading recent items…</p> : items.length ? <ul className="divide-y divide-slate-100">{items.map(item => <li key={item.key}><Link href={item.href} prefetch={false} onClick={() => setOpen(false)} className="block min-h-11 px-4 py-3 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-600 focus-visible:outline-offset-[-2px]">
        <span className="block text-xs font-semibold text-slate-500">{item.entityLabel}</span><span className="block break-words text-sm font-medium text-slate-900">{item.label}</span><time dateTime={item.lastViewedAt} className="mt-1 block text-xs text-slate-500">{item.viewedLabel} ET</time>
      </Link></li>)}</ul> : <p className="p-4 text-sm text-slate-600">No recent records yet. Open a CRM record to find it here.</p>}
    </section>}
  </div>;
}
