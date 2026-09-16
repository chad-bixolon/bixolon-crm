import Link from "next/link";
import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { ArchiveControl } from "@/components/archive-control";
import { roleLabels } from "@/lib/account-validation";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
const tabs = ["Overview", "Contacts", "Opportunities", "Activity", "Tasks", "Notes", "Orders", "Inventory"] as const;
export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const account = await prisma.account.findUnique({ where: { id }, include: { businessRoles: true, owner: { select: { firstName: true, lastName: true } }, industryCategory: true, territoryCategory: true,
    _count: { select: { contacts: true, opportunityMemberships: true, activities: true, tasks: true, notes: true } } } });
  if (!account) notFound();
  const rawTab = (await searchParams).tab ?? "Overview";
  const tab = tabs.find((t) => t.toLowerCase() === rawTab.toLowerCase()) ?? "Overview";
  const counts: Record<string, number> = { Contacts: account._count.contacts, Opportunities: account._count.opportunityMemberships, Activity: account._count.activities, Tasks: account._count.tasks, Notes: account._count.notes };
  const details = [["Status", account.status], ["Business roles", account.businessRoles.map((r) => roleLabels[r.role]).join(", ") || "—"], ["Owner", account.owner ? `${account.owner.firstName} ${account.owner.lastName}` : "Unassigned"], ["Strategic account", account.strategicAccount ? "Yes" : "No"], ["Territory", account.territoryCategory?.name ?? "—"], ["Industry", account.industryCategory?.name ?? "—"], ["Website", account.website ?? "—"], ["Phone", account.phone ?? "—"]];
  return <Content><PageHeader eyebrow="Accounts" title={account.name} description={`Account #${id}`} action={<div className="flex gap-2"><Link className="btn-secondary" href="/accounts">All accounts</Link>{account.status !== "ARCHIVED" && <Link className="btn-primary" href={`/accounts/${id}/edit`}>Edit account</Link>}</div>}/>
    <div className="panel mb-6 flex flex-wrap items-center justify-between gap-4 p-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{account.status}</span>{account.strategicAccount && <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">Strategic account</span>}{account.businessRoles.map((r) => <span key={r.role} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700">{roleLabels[r.role]}</span>)}</div><ArchiveControl id={id} archived={account.status === "ARCHIVED"}/></div>
    <nav aria-label="Account sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">{tabs.map((t) => <Link key={t} href={`/accounts/${id}?tab=${t.toLowerCase()}`} aria-current={tab === t ? "page" : undefined} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === t ? "border-orange-600 text-orange-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{t}{counts[t] !== undefined ? ` (${counts[t]})` : ""}</Link>)}</nav>
    {tab === "Overview" ? <div className="panel p-6"><h2 className="mb-5 text-lg font-semibold">Account profile</h2><dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">{details.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-900">{label === "Website" && account.website ? <a href={account.website} target="_blank" rel="noopener noreferrer" className="text-orange-700 underline">{value}</a> : value}</dd></div>)}</dl></div> : tab === "Orders" || tab === "Inventory" ? <div className="panel p-10"><h2 className="text-lg font-semibold">{tab} integration not connected</h2><p className="mt-2 text-sm text-slate-600">External {tab.toLowerCase()} data is unavailable until an integration is configured.</p></div> : <div className="panel p-10"><h2 className="text-lg font-semibold">{tab}</h2><p className="mt-2 text-sm text-slate-600">{counts[tab] === 0 ? `No ${tab.toLowerCase()} records are linked to this account.` : `${counts[tab]} ${tab.toLowerCase()} record${counts[tab] === 1 ? "" : "s"} linked to this account. Detailed management is planned for a later milestone.`}</p></div>}
  </Content>;
}
