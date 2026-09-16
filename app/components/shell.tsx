"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const nav = ["Dashboard", "Accounts", "Contacts", "Opportunities", "Pipeline", "Tasks", "Products", "Administration", "Integrations"];
const hrefFor = (item: string) => item === "Dashboard" ? "/" : `/${item.toLowerCase()}`;
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className="min-h-screen lg:flex">
    <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-3 px-5 py-5 lg:border-b lg:border-slate-100">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-600 text-lg font-bold text-white">B</span>
        <div><div className="text-sm font-bold tracking-wide text-slate-900">BIXOLON America</div><div className="text-xs font-semibold uppercase tracking-widest text-slate-500">CRM</div></div>
      </div>
      <nav aria-label="Primary navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:py-5">
        {nav.map((item) => { const href = hrefFor(item); const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <Link key={item} href={href} aria-current={active ? "page" : undefined} className={`block whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-orange-50 text-orange-800 border-l-2 border-orange-600" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>{item}</Link>; })}
      </nav>
    </aside>
    <div className="min-w-0 flex-1"><header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8"><span className="text-sm font-medium text-slate-600">BIXOLON America CRM</span><span className="text-xs text-slate-500">Internal workspace</span></header>{children}</div>
  </div>;
}
export function Content({ children }: { children: ReactNode }) { return <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8">{children}</main>; }
export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-orange-700">{eyebrow}</p>}<h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>{description && <p className="mt-2 text-sm text-slate-600">{description}</p>}</div>{action}</div>; }
