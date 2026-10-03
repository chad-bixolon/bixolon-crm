import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { canManageAttribution, campaignStatuses } from '@/lib/marketing-attribution';
import { campaignStatusLabel, canReadCampaigns } from '@/lib/campaign-view';
import { prisma } from '@/lib/prisma';

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; year?: string; archived?: string }> }) {
  const actor = await currentUser(); if (!canReadCampaigns(actor)) notFound();
  const filters = await searchParams, q = (filters.q ?? '').trim().slice(0, 120), year = Number(filters.year);
  const campaigns = await prisma.marketingCampaign.findMany({ where: { ...(filters.archived === 'true' ? { archivedAt: { not: null } } : { archivedAt: null }), ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}), ...(campaignStatuses.includes(filters.status as never) ? { status: filters.status } : {}), ...(Number.isInteger(year) && year >= 1900 && year <= 2200 ? { year } : {}) }, include: { tradeShow: { select: { id: true, name: true } }, _count: { select: { influences: { where: { voidedAt: null } } } } }, orderBy: [{ year: 'desc' }, { name: 'asc' }] });
  const manage = canManageAttribution(actor);
  return <Content><PageHeader eyebrow="Marketing" title="Campaigns" description="Marketing initiatives and their recorded influences." action={<div className="flex flex-wrap gap-2">{manage && <Link className="btn-primary" href="/marketing/campaigns/new">New Campaign</Link>}{manage && <Link className="btn-secondary" href="/marketing/lead-sources">Lead Sources</Link>}</div>}/>
    <form className="panel mb-5 flex flex-wrap gap-2 p-4"><input className="field" name="q" defaultValue={q} placeholder="Search Campaigns"/><select className="field" name="status" defaultValue={filters.status ?? ''}><option value="">All statuses</option>{campaignStatuses.map(status => <option key={status} value={status}>{campaignStatusLabel(status)}</option>)}</select><input className="field w-28" name="year" type="number" placeholder="Year" defaultValue={filters.year ?? ''}/><label className="flex items-center gap-1 text-sm"><input name="archived" value="true" type="checkbox" defaultChecked={filters.archived === 'true'}/>Archived</label><button className="btn-secondary">Filter</button></form>
    <div className="panel divide-y">{campaigns.map(campaign => <div key={campaign.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><div><Link className="font-medium text-orange-800 underline" href={`/marketing/campaigns/${campaign.id}`}>{campaign.name}</Link><div className="text-slate-500">{[campaign.year, campaignStatusLabel(campaign.status, campaign.archivedAt), ...(manage ? [`${campaign._count.influences} active influences`] : []), campaign.tradeShow?.name].filter(Boolean).join(' · ')}</div></div></div>)}{!campaigns.length && <p className="p-4 text-sm text-slate-500">No Campaigns match.</p>}</div>
  </Content>;
}
