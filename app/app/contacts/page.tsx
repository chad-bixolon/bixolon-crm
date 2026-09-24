import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { listContacts, marketingPreferenceLabels, type ContactFilters } from "@/lib/contacts";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<ContactFilters> }) {
  const filters = await searchParams;
  const [{ contacts, count, page, pages }, accounts] = await Promise.all([listContacts(prisma, filters), prisma.account.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const linkFor = (target: number) => { const p = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value && key !== "page") p.set(key, value); }); p.set("page", String(target)); return `/contacts?${p}`; };
  return <Content>
    <PageHeader eyebrow="CRM records" title="Contacts" description="Manage customer, partner, and prospect contacts." action={<Link className="btn-primary" href="/contacts/new">New contact</Link>}/>
    <form method="get" className="panel filter-panel filter-grid mb-5" aria-label="Filter contacts">
      <div><label className="label" htmlFor="q">Search</label><input className="field filter-control" id="q" name="q" defaultValue={filters.q ?? ""} placeholder="Name or email"/></div>
      <div><label className="label" htmlFor="active">Status</label><select className="field filter-control" id="active" name="active" defaultValue={filters.active ?? ""}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></div>
      <div><label className="label" htmlFor="accountId">Account</label><select className="field filter-control" id="accountId" name="accountId" defaultValue={filters.accountId ?? ""}><option value="">All accounts</option><option value="unassigned">Unassigned</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div><label className="label" htmlFor="marketingPreference">Marketing Preference</label><select className="field filter-control" id="marketingPreference" name="marketingPreference" defaultValue={filters.marketingPreference ?? ""}><option value="">All preferences</option><option value="UNKNOWN">Unknown / Not Confirmed</option><option value="OPTED_IN">Opted In</option><option value="OPTED_OUT">Opted Out</option></select></div>
      <div className="filter-actions"><button className="btn-filter-primary">Apply</button><Link className="btn-filter-secondary" href="/contacts">Clear</Link></div>
    </form>
    <div className="panel overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-4">Name</th><th className="px-5 py-4">Account</th><th className="px-5 py-4">Title</th><th className="px-5 py-4">Email</th><th className="px-5 py-4">Status</th></tr></thead><tbody className="divide-y">{contacts.map(c=><tr className="odd:bg-white even:bg-slate-50/60 hover:bg-orange-50/50" key={c.id}><td className="px-5 py-4"><Link className="font-semibold text-orange-800" href={`/contacts/${c.id}`}>{c.firstName} {c.lastName}</Link>{c.isPrimary&&<span className="ml-2 text-xs text-slate-500">Primary</span>}</td><td className="px-5 py-4">{c.account?<Link className="text-orange-800" href={`/accounts/${c.accountId}`}>{c.account.name}</Link>:"Unassigned"}</td><td className="px-5 py-4">{c.title??"—"}</td><td className="px-5 py-4">{c.email??"—"}</td><td className="px-5 py-4"><div>{c.archivedAt?"Archived":c.active?"Active":"Inactive"}</div><span className={`mt-1 inline-flex rounded px-2 py-0.5 text-xs font-medium ${c.marketingPreference==="OPTED_IN"?"bg-emerald-50 text-emerald-800":c.marketingPreference==="OPTED_OUT"?"bg-rose-50 text-rose-800":"bg-slate-100 text-slate-600"}`}>{marketingPreferenceLabels[c.marketingPreference]}</span></td></tr>)}</tbody></table>{contacts.length===0&&<p className="p-8 text-center text-sm text-slate-500">No contacts match these filters.</p>}</div>
    <div className="mt-4 flex justify-between text-sm text-slate-600"><span>{count} contacts · Page {page} of {pages}</span><div className="flex gap-2">{page>1&&<Link className="btn-secondary" href={linkFor(page-1)}>Previous</Link>}{page<pages&&<Link className="btn-secondary" href={linkFor(page+1)}>Next</Link>}</div></div>
  </Content>;
}
