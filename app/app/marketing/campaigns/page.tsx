import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { canManageAttribution, campaignStatuses } from '@/lib/marketing-attribution';
import { campaignStatusLabel, canReadCampaigns } from '@/lib/campaign-view';
import { formatCalendarDate } from '@/lib/display-format';
import { prisma } from '@/lib/prisma';

const dateRange = (start: Date | null, end: Date | null) =>
  [start, end].filter((date): date is Date => date !== null).map(formatCalendarDate).join(' – ');

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; year?: string; archived?: string }> }) {
  const actor = await currentUser(); if (!canReadCampaigns(actor)) notFound();
  const filters = await searchParams, q = (filters.q ?? '').trim().slice(0, 120), year = Number(filters.year);
  const campaigns = await prisma.marketingCampaign.findMany({ where: { ...(filters.archived === 'true' ? { archivedAt: { not: null } } : { archivedAt: null }), ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}), ...(campaignStatuses.includes(filters.status as never) ? { status: filters.status } : {}), ...(Number.isInteger(year) && year >= 1900 && year <= 2200 ? { year } : {}) }, include: { tradeShow: { select: { id: true, name: true } }, _count: { select: { influences: { where: { voidedAt: null } } } } }, orderBy: [{ year: 'desc' }, { name: 'asc' }] });
  const manage = canManageAttribution(actor);
  const hasCampaigns = campaigns.length > 0 || await prisma.marketingCampaign.count() > 0;
  return <Content><PageHeader eyebrow="Marketing" title="Campaigns" description="Marketing initiatives and their recorded influences." action={<div className="flex flex-wrap gap-2">{manage && <Link className="btn-primary" href="/marketing/campaigns/new">New Campaign</Link>}{manage && <Link className="btn-secondary" href="/marketing/lead-sources">Lead Sources</Link>}</div>}/>
    <form className="panel mb-4 p-3 sm:p-4" method="get" aria-label="Filter Campaigns">
      <div className="filter-grid campaign-filter-grid">
        <div><label className="label" htmlFor="campaign-search">Search Campaigns</label><input className="field filter-control" id="campaign-search" name="q" defaultValue={q} placeholder="Search Campaigns"/></div>
        <div><label className="label" htmlFor="campaign-status">Status</label><select className="field filter-control" id="campaign-status" name="status" defaultValue={filters.status ?? ''}><option value="">All statuses</option>{campaignStatuses.map(status => <option key={status} value={status}>{campaignStatusLabel(status)}</option>)}</select></div>
        <div><label className="label" htmlFor="campaign-year">Year</label><input className="field filter-control" id="campaign-year" name="year" type="number" placeholder="Year" defaultValue={filters.year ?? ''}/></div>
        <label className="campaign-filter-archived flex items-center gap-2 text-sm"><input name="archived" value="true" type="checkbox" defaultChecked={filters.archived === 'true'}/>Archived</label>
        <button className="btn-filter-secondary campaign-filter-submit" type="submit">Filter</button>
      </div>
    </form>
    <ul className="panel divide-y divide-slate-100">{campaigns.map(campaign => <li key={campaign.id} className="flex flex-wrap items-start justify-between gap-x-5 gap-y-1 px-4 py-3 text-sm">
      <div className="min-w-0"><Link className="font-semibold text-orange-800 underline hover:text-orange-900" href={`/marketing/campaigns/${campaign.id}`}>{campaign.name}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-slate-600">{campaign.year && <><span>{campaign.year}</span><span aria-hidden="true">·</span></>}<span className={campaign.archivedAt ? 'rounded bg-slate-100 px-1.5 text-slate-700' : ''}>{campaignStatusLabel(campaign.status, campaign.archivedAt)}</span>{campaign.category && <><span aria-hidden="true">·</span><span>{campaign.category}</span></>}{campaign.tradeShow && <><span aria-hidden="true">·</span><span>Trade Show: {campaign.tradeShow.name}</span></>}</div>
        {(campaign.startDate || campaign.endDate) && <div className="mt-0.5 text-slate-500">{dateRange(campaign.startDate, campaign.endDate)}</div>}
      </div>
      {manage && <span className="shrink-0 text-xs text-slate-500 sm:pt-0.5">{campaign._count.influences} active influences</span>}
    </li>)}{!campaigns.length && <li className="px-4 py-6 text-sm text-slate-600">{hasCampaigns ? 'No Campaigns match the current filters.' : manage ? 'Create the first Campaign to begin tracking Marketing influence.' : 'No Campaigns yet.'}</li>}</ul>
  </Content>;
}
