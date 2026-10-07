import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { campaignStatusLabel, influenceSourceLabel } from '@/lib/campaign-view';
import { canViewMarketingReports, marketingAttributionReport, type AttributionFilters } from '@/lib/marketing-attribution-report';

export const dynamic = 'force-dynamic';
const name = (person?: { firstName: string; lastName: string } | null) => person ? `${person.firstName} ${person.lastName}` : '—';

export default async function MarketingAttributionPage({ searchParams }: { searchParams: Promise<AttributionFilters> }) {
  const actor = await currentUser(); if (!canViewMarketingReports(actor)) notFound();
  const params = await searchParams;
  const [report, campaigns, sources, reps] = await Promise.all([
    marketingAttributionReport(prisma, actor, params),
    prisma.marketingCampaign.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }),
    prisma.leadSourceOption.findMany({ select: { id: true, name: true, active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.user.findMany({ where: { role: { in: ['SALES', 'SALES_MANAGER'] } }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
  ]);
  const query = (page: number) => { const next = new URLSearchParams(); for (const [key, value] of Object.entries(params)) if (key !== 'page' && typeof value === 'string') next.set(key, value); next.set('page', String(page)); return `/reports/marketing-attribution?${next}`; };
  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.reports} title="Marketing Attribution" description="Recorded Campaign Influence activity. Each touch appears once; voided touches remain visible for review." />
    <form className="panel filter-panel filter-grid filter-row mb-5" method="get" aria-label="Filter Marketing Attribution">
      <label className="text-sm">From<input className="field mt-1 block w-full" name="from" type="date" defaultValue={params.from}/></label>
      <label className="text-sm">To<input className="field mt-1 block w-full" name="to" type="date" defaultValue={params.to}/></label>
      <label className="text-sm">Lead Source<select className="field mt-1 block w-full" name="leadSourceId" defaultValue={params.leadSourceId ?? ''}><option value="">All sources</option>{sources.map(source => <option value={source.id} key={source.id}>{source.name}{source.active ? '' : ' (inactive)'}</option>)}</select></label>
      <label className="text-sm">Campaign<select className="field mt-1 block w-full" name="campaignId" defaultValue={params.campaignId ?? ''}><option value="">All campaigns</option>{campaigns.map(campaign => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select></label>
      <label className="text-sm">Campaign status<select className="field mt-1 block w-full" name="campaignStatus" defaultValue={params.campaignStatus ?? ''}><option value="">All statuses</option>{['PLANNED', 'ACTIVE', 'COMPLETED'].map(status => <option value={status} key={status}>{campaignStatusLabel(status)}</option>)}</select></label>
      <label className="text-sm">Record type<select className="field mt-1 block w-full" name="recordType" defaultValue={params.recordType ?? ''}><option value="">All types</option><option value="TRADE_SHOW_LEAD">Trade Show Lead</option><option value="CONTACT">Contact</option><option value="OPPORTUNITY">Opportunity</option></select></label>
      <label className="text-sm">Sales Rep / Owner<select className="field mt-1 block w-full" name="ownerId" defaultValue={params.ownerId ?? ''}><option value="">All owners</option>{reps.map(rep => <option value={rep.id} key={rep.id}>{name(rep)}</option>)}</select></label>
      <label className="text-sm">Search<input className="field mt-1 block w-full" name="q" maxLength={100} defaultValue={params.q ?? ''} placeholder="Campaign or record name"/></label>
      <div className="flex items-end gap-2"><button className="btn-primary">Filter</button><Link className="btn-secondary" href="/reports/marketing-attribution">Clear</Link></div>
    </form>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Active Campaigns',report.activeCampaigns],['Campaign Influences in period',report.summary.influences],['Influenced Contacts',report.summary.contacts],['Influenced Opportunities',report.summary.opportunities],['Trade Show Leads influenced',report.summary.leads]].map(([label,value])=><div className="panel p-4" key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
    <p className="mb-3 text-sm text-slate-600">Counts include active touches only. Linked Trade Show Contacts and converted Opportunities count once. Opportunity names and stages are current CRM context; they do not represent attributed revenue.</p>
    <section className="panel overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-slate-50"><tr>{['Date','Campaign','Lead Source','Influence Type / Source Context','Record Type','Contact / Lead / Opportunity','Account','Opportunity Stage','Forecast Category','Sales Rep / Owner','Status'].map(label=><th className="px-3 py-3" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{report.rows.map(row=>{const lead=row.tradeShowLead,contact=row.contact,opportunity=row.opportunity;const kind=lead?'Trade Show Lead':contact?'Contact':'Opportunity';const target=lead?`/trade-shows/${lead.tradeShowId}/leads/${lead.id}`:contact?`/contacts/${contact.id}`:`/opportunities/${opportunity?.id}`;const label=lead?name(lead):contact?name(contact):opportunity?.name??'—';const account=lead?.account?.name??contact?.account?.name??(opportunity?.participants.length===1?opportunity.participants[0].account.name:null);return <tr key={row.id}><td className="whitespace-nowrap px-3 py-3">{row.occurredAt.toISOString().slice(0,10)}</td><td className="px-3 py-3"><Link className="text-orange-800 underline" href={`/marketing/campaigns/${row.campaign.id}`}>{row.campaign.name}</Link></td><td className="px-3 py-3">{lead?.leadSource?.name??contact?.leadSource?.name??opportunity?.originatingTradeShowLead?.leadSource?.name??'—'}</td><td className="px-3 py-3">{influenceSourceLabel(row.sourceContext)}</td><td className="px-3 py-3">{kind}</td><td className="px-3 py-3"><Link className="text-orange-800 underline" href={target}>{label}</Link></td><td className="px-3 py-3">{account??'—'}</td><td className="px-3 py-3">{opportunity?.stage.name??'—'}</td><td className="px-3 py-3">{opportunity?.forecastCategory.replaceAll('_',' ')??'—'}</td><td className="px-3 py-3">{name(opportunity?.owner??lead?.assignedSalesRep)}</td><td className="px-3 py-3">{row.voidedAt?'Voided':'Active'}</td></tr>;})}</tbody></table>{!report.rows.length&&<p className="p-5 text-sm text-slate-600">No Campaign Influences match these filters.</p>}</section>
    <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Report pages">{report.filters.page>1&&<Link className="text-orange-800 underline" href={query(report.filters.page-1)}>Previous</Link>}<span>Page {report.filters.page}</span>{report.hasNext&&<Link className="text-orange-800 underline" href={query(report.filters.page+1)}>Next</Link>}</nav>
  </Content>;
}
