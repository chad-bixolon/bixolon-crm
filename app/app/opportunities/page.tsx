import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { forecastLabels } from "@/lib/crm-validation";
import { listOpportunities, opportunityOptions, opportunityTotal, type OpportunityFilters } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/display-format";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<OpportunityFilters> }) {
  const filters = await searchParams;
  const [{ opportunities, count, page, pages }, options] = await Promise.all([listOpportunities(prisma, filters), opportunityOptions(prisma)]);
  const mixedCurrencies = new Set(opportunities.map(o => o.currencyCode)).size > 1;
  const linkFor = (target: number) => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value && key !== "page") p.set(key, value); });
    p.set("page", String(target));
    return `/opportunities?${p}`;
  };
  const control = "field filter-control";

  return <Content>
    <PageHeader eyebrow="CRM records" title="Opportunities" description="Sales opportunities and participating accounts." action={<Link className="btn-primary" href="/opportunities/new">New opportunity</Link>}/>
    <form method="get" className="panel filter-panel filter-grid mb-5" aria-label="Filter opportunities">
      <div><label className="label" htmlFor="q">Search</label><input className={control} id="q" name="q" defaultValue={filters.q ?? ""} placeholder="Opportunity name"/></div>
      <div><label className="label" htmlFor="stageId">Stage</label><select className={control} id="stageId" name="stageId" defaultValue={filters.stageId ?? ""}><option value="">All stages</option>{options.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div><label className="label" htmlFor="competitorId">Competitor</label><select className={control} id="competitorId" name="competitorId" defaultValue={filters.competitorId ?? ""}><option value="">All competitors</option>{options.competitors.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}{filters.competitorId && !options.competitors.some(option => String(option.id) === filters.competitorId) && <option value={filters.competitorId}>Selected inactive competitor</option>}</select></div>
      <div><label className="label" htmlFor="ownerId">Owner</label><select className={control} id="ownerId" name="ownerId" defaultValue={filters.ownerId ?? ""}><option value="">All owners</option>{options.owners.map(o => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}</select></div>
      <div><label className="label" htmlFor="forecastCategory">Forecast</label><select className={control} id="forecastCategory" name="forecastCategory" defaultValue={filters.forecastCategory ?? ""}><option value="">All categories</option>{Object.entries(forecastLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>
      <div><label className="label" htmlFor="closeFrom">Close Date From</label><input className={control} type="date" id="closeFrom" name="closeFrom" defaultValue={filters.closeFrom ?? ""}/></div>
      <div><label className="label" htmlFor="closeTo">Close Date Through</label><input className={control} type="date" id="closeTo" name="closeTo" defaultValue={filters.closeTo ?? ""}/></div>
      <div><label className="label" htmlFor="accountId">Participating Account</label><select className={control} id="accountId" name="accountId" defaultValue={filters.accountId ?? ""}><option value="">All accounts</option>{options.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div><label className="label" htmlFor="projectId">Project</label><select className={control} id="projectId" name="projectId" defaultValue={filters.projectId ?? ""}><option value="">All Projects</option><option value="none">No Project</option>{options.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><label className="label" htmlFor="archived">Visibility</label><select className={control} id="archived" name="archived" defaultValue={filters.archived ?? ""}><option value="">Active</option><option value="yes">Archived</option><option value="all">All</option></select></div>
      <div className="filter-actions"><button className="btn-filter-primary">Apply</button><Link className="btn-filter-secondary" href="/opportunities">Clear</Link></div>
    </form>
    <div className="panel overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Opportunity</th><th className="px-5 py-3">Participants</th><th className="px-5 py-3">Stage</th><th className="px-5 py-3">Owner</th><th className="px-5 py-3">Close</th><th className="px-5 py-3 text-right">Total</th></tr></thead><tbody className="divide-y">{opportunities.map(o => <tr className="even:bg-slate-50/60 hover:bg-orange-50/50 focus-within:bg-orange-50/50" key={o.id}><td className="px-5 py-4"><Link className="font-semibold text-orange-800" href={`/opportunities/${o.id}`}>{o.name}</Link>{o.archivedAt&&<span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs font-semibold">Archived</span>}</td><td className="px-5 py-4">{o.participants.map(p => <Link key={p.accountId} className="mr-2 text-orange-800" href={`/accounts/${p.accountId}`}>{p.account.name}</Link>)}</td><td className="px-5 py-4">{o.stage.name}</td><td className="px-5 py-4">{o.owner ? `${o.owner.firstName} ${o.owner.lastName}` : "Unassigned"}</td><td className="px-5 py-4">{o.expectedCloseDate?.toISOString().slice(0, 10) ?? "—"}</td><td className="px-5 py-4 text-right tabular-nums">{formatCurrency(opportunityTotal(o.products), o.currencyCode, mixedCurrencies)}</td></tr>)}</tbody></table>{!opportunities.length && <p className="p-8 text-center text-sm text-slate-500">No opportunities match these filters.</p>}</div>
    <div className="mt-4 flex justify-between text-sm text-slate-600"><span>{count} opportunities · Page {page} of {pages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={linkFor(page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={linkFor(page + 1)}>Next</Link>}</div></div>
  </Content>;
}
