"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@prisma/client";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/sign-out-action";

const nav = ["Dashboard", "Accounts", "Contacts", "Projects", "Opportunities", "Pipeline", "Tasks", "Products", "Administration", "Integrations"];
const hrefFor = (item: string) => item === "Dashboard" ? "/" : `/${item.toLowerCase()}`;
const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrator",
  SALES_MANAGER: "Sales Manager",
  SALES: "Sales",
  MARKETING_MANAGER: "Marketing Manager",
  READ_ONLY: "Read Only",
};
type ShellUser = { name: string; role: UserRole; canManageUsers: boolean };
export function Shell({ children, user }: { children: ReactNode; user: ShellUser | null }) {
  const pathname = usePathname();
  if (pathname === "/sign-in") return <div className="min-h-screen">{children}</div>;
  return <div className="min-h-screen lg:flex">
    <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-3 px-5 py-5 lg:border-b lg:border-slate-100">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-600 text-lg font-bold text-white">B</span>
        <div><div className="text-sm font-bold tracking-wide text-slate-900">BIXOLON America</div><div className="text-xs font-semibold uppercase tracking-widest text-slate-500">CRM</div></div>
      </div>
      <nav aria-label="Primary navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:py-5">
        {nav.filter((item) => item !== "Administration" || user?.canManageUsers).map((item) => { const href = hrefFor(item); const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <Link key={item} href={href} aria-current={active ? "page" : undefined} className={`block whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-orange-50 text-orange-800 border-l-2 border-orange-600" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>{item}</Link>; })}
      </nav>
    </aside>
    <div className="min-w-0 flex-1"><header className="flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3 lg:px-8"><span className="text-sm font-medium text-slate-600">BIXOLON America CRM</span>{user && <div className="flex items-center gap-4"><div className="text-right"><div className="text-sm font-semibold text-slate-900">{user.name}</div><div className="text-xs text-slate-500">{roleLabels[user.role]}</div></div><form action={signOutAction}><button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Sign out</button></form></div>}</header>{children}</div>
  </div>;
}
export function Content({ children }: { children: ReactNode }) { return <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8">{children}</main>; }
export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-orange-700">{eyebrow}</p>}<h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>{description && <p className="mt-2 text-sm text-slate-600">{description}</p>}</div>{action}</div>; }
