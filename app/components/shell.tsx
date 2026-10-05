"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { roleLabels } from "@/lib/role-labels";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/sign-out-action";
import { endImpersonation } from "@/app/dev/impersonation/actions";
import type { LabelMap } from "@/lib/configuration";

const navSections = [
  { label: "CRM", items: ["Dashboard", "Accounts", "Contacts"] },
  { label: "Sales", items: ["Opportunities", "Pipeline", "Sales Plan", "Tasks", "Demos"] },
  { label: "Programs", items: ["Projects"] },
  { label: "Marketing", items: ["Trade Shows", "Campaigns", "Marketing Audiences"] },
  { label: "Catalog & Pricing", items: ["Products", "Price Exceptions"] },
  { label: "Reports", items: ["Reports"] },
  { label: "Administration", items: ["Administration", "Integrations"] },
] as const;
const hrefFor = (item: string) => item === "Dashboard" ? "/" : item === "Sales Plan" ? "/sales-plan" : item === "Price Exceptions" ? "/price-exceptions" : item === "Trade Shows" ? "/trade-shows" : item === "Campaigns" ? "/marketing/campaigns" : item === "Marketing Audiences" ? "/marketing/audiences" : `/${item.toLowerCase()}`;
const navLabelKeys: Partial<Record<string, keyof LabelMap>> = { Accounts: "ACCOUNT", Contacts: "CONTACT", Projects: "PROJECT", Opportunities: "OPPORTUNITY", Tasks: "TASK" };
type ShellUser = { name: string; role: UserRole; canManageUsers: boolean; canViewReports: boolean; canViewMarketing:boolean; canViewSales:boolean; canViewOpportunities:boolean };
type NavItem = (typeof navSections)[number]["items"][number];
function canSeeNavItem(item: NavItem, user: ShellUser | null) {
  if (!user) return false;
  switch (item) {
    case "Administration":
    case "Integrations": return user.canManageUsers;
    case "Reports": return user.canViewReports;
    case "Opportunities": return user.canViewOpportunities;
    case "Pipeline":
    case "Sales Plan": return user.canViewSales;
    case "Campaigns": return true;
    case "Marketing Audiences": return user.canViewMarketing;
    case "Demos": return user.role === "ADMIN";
    default: return true;
  }
}
export function Shell({ children, user, labels, developmentAdmin = false, impersonating = null }: { children: ReactNode; user: ShellUser | null; labels?: LabelMap; developmentAdmin?: boolean; impersonating?: { realName: string; effectiveName: string; role: UserRole } | null }) {
  const pathname = usePathname();
  if (pathname === "/sign-in") return <div className="min-h-screen">{children}</div>;
  return <div className="min-h-screen lg:flex lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    <aside className="border-b border-slate-200 bg-white lg:flex lg:h-full lg:min-h-0 lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
      <div className="px-5 py-5 lg:shrink-0 lg:border-b lg:border-slate-100">
        <Image src="/brand/bixolon-logo.png" alt="BIXOLON" width={500} height={40} priority className="h-6 w-44 object-cover object-center" />
      </div>
      <nav aria-label="Primary navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:min-h-0 lg:flex-1 lg:space-y-1 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain lg:py-5">
        {navSections.map(section => { const visible = section.items.filter(item => canSeeNavItem(item, user)); return visible.length ? <div key={section.label} className="flex shrink-0 gap-1 lg:mb-4 lg:block"><p className="hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400 lg:block">{section.label}</p>{visible.map((item) => { const href = hrefFor(item); const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const key = navLabelKeys[item];
          const title = labels && key ? key === "OPPORTUNITY" && labels[key] === "Opportunity" ? "Opportunities" : `${labels[key]}s` : item;
          return <Link key={item} href={href} aria-current={active ? "page" : undefined} className={`block whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-orange-50 text-orange-800 border-l-2 border-orange-600" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>{title}</Link>; })}</div> : null; })}
      </nav>
    </aside>
    <div className="min-w-0 flex-1 lg:h-full lg:min-h-0 lg:overflow-y-auto">{impersonating && <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400 bg-amber-100 px-5 py-3 text-sm text-amber-950 lg:px-8"><div><strong>Development mode — Testing as {impersonating.effectiveName} · {roleLabels[impersonating.role]}</strong><span className="ml-3 text-xs">Signed in as {impersonating.realName}</span></div><form action={endImpersonation}><button type="submit" className="rounded-md bg-amber-900 px-3 py-1.5 font-semibold text-white">Return to Admin</button></form></div>}<header className="flex min-h-16 items-center justify-end gap-4 border-b border-slate-200 bg-white px-5 py-3 lg:px-8">{user && <div className="flex items-center gap-4">{developmentAdmin && <Link href="/dev/impersonation" className="btn-secondary">Test as user</Link>}<div className="text-right"><div className="text-sm font-semibold text-slate-900">{user.name}</div><div className="text-xs text-slate-500">{roleLabels[user.role]}</div></div><form action={signOutAction}><button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Sign out</button></form></div>}</header>{children}</div>
  </div>;
}
export function Content({ children }: { children: ReactNode }) { return <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8">{children}</main>; }
export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-orange-700">{eyebrow}</p>}<h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>{description && <p className="mt-2 text-sm text-slate-600">{description}</p>}</div>{action}</div>; }
