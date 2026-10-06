'use client';
import { useState } from 'react';
import Link from 'next/link';
import { NotificationItems } from './notification-items';
import { markAllRead } from '@/app/notifications/actions';
import type { NotificationItem } from '@/lib/notifications';

export function NotificationBell({ unread, rows }: { unread: number; rows: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  return <div className="relative"><button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(value => !value)} className="relative rounded-md border border-slate-300 p-2 text-slate-700 hover:bg-slate-50"><svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></svg>{unread>0&&<span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-orange-700 px-1 text-center text-[10px] font-bold leading-5 text-white">{unread>99?'99+':unread}</span>}</button>
    {open&&<div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"><div className="flex items-center justify-between gap-2 border-b px-4 py-3"><strong className="text-sm">Notifications</strong>{unread>0&&<form action={markAllRead}><button className="text-xs text-orange-800 hover:underline">Mark all read</button></form>}</div><div className="max-h-[min(65vh,34rem)] overflow-y-auto">{rows.length?<NotificationItems rows={rows} compact/>:<p className="p-4 text-sm text-slate-600">No active notifications.</p>}</div><Link href="/notifications" onClick={() => setOpen(false)} className="block border-t px-4 py-3 text-center text-sm font-semibold text-orange-800 hover:bg-orange-50">View all notifications</Link></div>}
  </div>;
}
