"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { roleLabels } from "@/lib/role-labels";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/sign-out-action";
import type { LabelMap } from "@/lib/configuration";

const nav = ["Dashboard", "Accounts", "Contacts", "Projects", "Opportunities", "Pipeline", "Tasks", "Engagement", "Products", "Administration", "Integrations"];
const hrefFor = (item: string) => item === "Dashboard" ? "/" : item === "Engagement" ? "/reports/engagement" : `/${item.toLowerCase()}`;
const navLabelKeys: Partial<Record<string, keyof LabelMap>> = { Accounts: "ACCOUNT", Contacts: "CONTACT", Projects: "PROJECT", Opportunities: "OPPORTUNITY", Tasks: "TASK" };
type ShellUser = { name: string; role: UserRole; canManageUsers: boolean };
export function Shell({ children, user, labels }: { children: ReactNode; user: ShellUser | null; labels?: LabelMap }) {
  const pathname = usePathname();
  if (pathname === "/sign-in") return <div className="min-h-screen">{children}</div>;
  return <div className="min-h-screen lg:flex">
    <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="px-5 py-5 lg:border-b lg:border-slate-100">
        <Image src="/brand/bixolon-logo.png" alt="BIXOLON" width={500} height={40} priority className="h-6 w-44 object-cover object-center" />
      </div>
      <nav aria-label="Primary navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:py-5">
        {nav.filter((item) => (item !== "Administration" || user?.canManageUsers) && (item !== "Engagement" || ['ADMIN','SALES_MANAGER','SALES'].includes(user?.role ?? ''))).map((item) => { const href = hrefFor(item); const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const key = navLabelKeys[item];
          const title = labels && key ? key === "OPPORTUNITY" && labels[key] === "Opportunity" ? "Opportunities" : `${labels[key]}s` : item;
          return <Link key={item} href={href} aria-current={active ? "page" : undefined} className={`block whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-orange-50 text-orange-800 border-l-2 border-orange-600" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>{title}</Link>; })}
      </nav>
    </aside>
    <div className="min-w-0 flex-1"><header className="flex min-h-16 items-center justify-end gap-4 border-b border-slate-200 bg-white px-5 py-3 lg:px-8">{user && <div className="flex items-center gap-4"><div className="text-right"><div className="text-sm font-semibold text-slate-900">{user.name}</div><div className="text-xs text-slate-500">{roleLabels[user.role]}</div></div><form action={signOutAction}><button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Sign out</button></form></div>}</header>{children}</div>
  </div>;
}
export function Content({ children }: { children: ReactNode }) { return <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8">{children}</main>; }
export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-orange-700">{eyebrow}</p>}<h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>{description && <p className="mt-2 text-sm text-slate-600">{description}</p>}</div>{action}</div>; }
