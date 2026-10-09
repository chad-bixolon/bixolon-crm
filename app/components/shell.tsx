"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { roleLabels } from "@/lib/role-labels";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOutAction } from "@/app/sign-out-action";
import { endImpersonation } from "@/app/dev/impersonation/actions";
import type { LabelMap } from "@/lib/configuration";
import { NotificationBell } from './notification-bell';
import type { NotificationItem } from '@/lib/notifications';
import { NAV_CATEGORIES } from '../lib/navigation-categories';

const navSections = [
  { label: NAV_CATEGORIES.crm, items: ["Dashboard", "Accounts", "Contacts"] },
  { label: NAV_CATEGORIES.sales, items: ["Opportunities", "Pipeline", "Sales Plan", "Tasks", "Calendar Matches", "Demos"] },
  { label: NAV_CATEGORIES.support, items: ["Support Cases"] },
  { label: NAV_CATEGORIES.programs, items: ["Projects"] },
  { label: NAV_CATEGORIES.marketing, items: ["Trade Shows", "Campaigns", "Marketing Audiences"] },
  { label: NAV_CATEGORIES.catalogPricing, items: ["Products", "Price Exceptions"] },
  { label: NAV_CATEGORIES.reports, items: ["Reports"] },
  { label: NAV_CATEGORIES.administration, items: ["Administration", "Integrations"] },
] as const;
const hrefFor = (item: string) => item === "Dashboard" ? "/" : item === "Support Cases" ? "/support/cases" : item === "Sales Plan" ? "/sales-plan" : item === "Calendar Matches" ? "/calendar-matches" : item === "Price Exceptions" ? "/price-exceptions" : item === "Trade Shows" ? "/trade-shows" : item === "Campaigns" ? "/marketing/campaigns" : item === "Marketing Audiences" ? "/marketing/audiences" : `/${item.toLowerCase()}`;
const navLabelKeys: Partial<Record<string, keyof LabelMap>> = { Accounts: "ACCOUNT", Contacts: "CONTACT", Projects: "PROJECT", Opportunities: "OPPORTUNITY", Tasks: "TASK" };
type ShellUser = { name: string; role: UserRole; canManageUsers: boolean; canViewReports: boolean; canViewMarketing:boolean; canViewSales:boolean; canViewOpportunities:boolean; canViewSupport:boolean };
type NavItem = (typeof navSections)[number]["items"][number];
function canSeeNavItem(item: NavItem, user: ShellUser | null) {
  if (!user) return false;
  if (user.role === 'SUPPORT') return ['Dashboard', 'Accounts', 'Contacts', 'Products', 'Support Cases'].includes(item);
  switch (item) {
    case "Administration":
    case "Integrations": return user.canManageUsers;
    case "Reports": return user.canViewReports;
    case "Support Cases": return user.canViewSupport;
    case "Opportunities": return user.canViewOpportunities;
    case "Pipeline":
    case "Sales Plan": return user.canViewSales;
    case "Calendar Matches": return user.canViewSales;
    case "Campaigns": return true;
    case "Marketing Audiences": return user.canViewMarketing;
    case "Demos": return user.role === "ADMIN";
    default: return true;
  }
}
export function Shell({ children, user, labels, notifications, developmentAdmin = false, impersonating = null }: { children: ReactNode; user: ShellUser | null; labels?: LabelMap; notifications?: { unread: number; rows: NotificationItem[] } | null; developmentAdmin?: boolean; impersonating?: { realName: string; effectiveName: string; role: UserRole } | null }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const currentItem = navSections.flatMap(section => section.items).filter(item => canSeeNavItem(item, user)).find(item => { const href = hrefFor(item); return href === '/' ? pathname === '/' : pathname.startsWith(href); });
  const currentKey = currentItem && navLabelKeys[currentItem];
  const currentTitle = currentItem && currentKey && labels ? currentKey === 'OPPORTUNITY' && labels[currentKey] === 'Opportunity' ? 'Opportunities' : `${labels[currentKey]}s` : currentItem ?? 'SalesHub';
  useEffect(() => { if (menuOpen) closeButton.current?.focus(); }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); }
      if (event.key === 'Tab' && drawer.current) {
        const focusable = [...drawer.current.querySelectorAll<HTMLElement>('button, a[href]')];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);
  if (pathname === "/sign-in") return <div className="min-h-screen">{children}</div>;
  return <div className="min-h-screen min-w-0 lg:flex lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    {menuOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden" onClick={() => setMenuOpen(false)}/>}
    <aside ref={drawer} id="primary-navigation-drawer" className={`${menuOpen ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-3rem))] flex-col border-r border-slate-200 bg-white shadow-xl lg:static lg:flex lg:h-full lg:min-h-0 lg:w-60 lg:shrink-0 lg:shadow-none`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-5 lg:shrink-0">
        <Image src="/brand/bixolon-logo.png" alt="BIXOLON" width={500} height={40} priority className="h-6 w-44 object-cover object-center" />
        <button ref={closeButton} type="button" aria-label="Close menu" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-orange-600 lg:hidden" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }}>×</button>
      </div>
      <nav aria-label="Primary navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-5">
        {navSections.map(section => { const visible = section.items.filter(item => canSeeNavItem(item, user)); return visible.length ? <div key={section.label} className="mb-4"><p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{section.label}</p>{visible.map((item) => { const href = hrefFor(item); const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const key = navLabelKeys[item];
          const title = labels && key ? key === "OPPORTUNITY" && labels[key] === "Opportunity" ? "Opportunities" : `${labels[key]}s` : item;
          return <Link key={item} href={href} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)} className={`block min-h-11 rounded-md px-3 py-3 text-sm font-medium transition-colors ${active ? "bg-orange-50 text-orange-800 border-l-2 border-orange-600" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>{title}</Link>; })}</div> : null; })}
      </nav>
      {user && <div className="border-t border-slate-100 px-3 py-3 lg:hidden"><p className="px-3 py-2 text-xs text-slate-500">{user.name} · {roleLabels[user.role]}</p><Link href="/my-integrations" onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">My integrations</Link>{developmentAdmin && <Link href="/dev/impersonation" onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">Test as user</Link>}</div>}
    </aside>
    <div className="min-w-0 flex-1 lg:h-full lg:min-h-0 lg:overflow-y-auto">
      {impersonating && <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400 bg-amber-100 px-5 py-3 text-sm text-amber-950 lg:px-8"><div><strong>Development mode — Testing as {impersonating.effectiveName} · {roleLabels[impersonating.role]}</strong><span className="ml-3 text-xs">Signed in as {impersonating.realName}</span></div><form action={endImpersonation}><button type="submit" className="rounded-md bg-amber-900 px-3 py-1.5 font-semibold text-white">Return to Admin</button></form></div>}
      <header className="flex min-h-16 min-w-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 sm:px-5 lg:justify-end lg:px-8">
        <button ref={menuButton} type="button" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="primary-navigation-drawer" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-2xl text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-orange-600 lg:hidden" onClick={() => setMenuOpen(true)}>☰</button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 lg:hidden">{currentTitle}</span>
        {user && <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          {notifications && <NotificationBell {...notifications} />}
          <Link href="/my-integrations" className="hidden text-sm font-medium text-orange-800 hover:underline sm:block">My integrations</Link>
          {developmentAdmin && <Link href="/dev/impersonation" className="btn-secondary hidden sm:inline-flex">Test as user</Link>}
          <div className="hidden text-right sm:block"><div className="text-sm font-semibold text-slate-900">{user.name}</div><div className="text-xs text-slate-500">{roleLabels[user.role]}</div></div>
          <form action={signOutAction}><button type="submit" className="btn-secondary">Sign out</button></form>
        </div>}
      </header>
      {children}
    </div>
  </div>;
}
export function Content({ children }: { children: ReactNode }) { return <main className="mx-auto min-w-0 max-w-7xl px-4 py-6 sm:px-5 sm:py-8 lg:px-8">{children}</main>; }
export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="mb-7 flex min-w-0 flex-wrap items-end justify-between gap-4"><div className="min-w-0 max-w-full">{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-orange-700">{eyebrow}</p>}<h1 className="break-words text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>{description && <p className="mt-2 break-words text-sm text-slate-600">{description}</p>}</div>{action}</div>; }
