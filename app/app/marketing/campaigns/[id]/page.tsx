import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { canManageAttribution } from '@/lib/marketing-attribution';
import { campaignContactWhere, campaignInfluenceReadWhere, campaignOpportunityWhere, campaignStatusLabel, canReadCampaigns, influenceSourceLabel } from '@/lib/campaign-view';
import { tradeShowLeadReadWhere } from '@/lib/trade-shows';
import { prisma } from '@/lib/prisma';
import { setCampaignArchive } from '@/app/marketing/attribution/actions';

const date = (value: Date) => value.toISOString().slice(0, 10);
const time = (value: Date) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(value);
const linkClass = 'text-orange-800 underline';

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const actor = await currentUser(); if (!canReadCampaigns(actor)) notFound();
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id < 1) notFound();
  const requestedPage = Number((await searchParams).page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000) : 1;
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id }, include: { tradeShow: { select: { id: true, name: true } } } });
  if (!campaign) notFound();
  const manage = canManageAttribution(actor);
  const canOpenOpportunity = can(actor, 'opportunities.read');
  const influenceWhere = campaignInfluenceReadWhere(actor, id);
  const leadWhere = { AND: [tradeShowLeadReadWhere(actor), { campaignInfluences: { some: { campaignId: id, voidedAt: null } } }] };
  const contactWhere = campaignContactWhere(actor, id);
  const opportunityWhere = campaignOpportunityWhere(actor, id);
  const [leadCount, contactCount, opportunityCount, activeCount, influences, leads, contacts, opportunities] = await Promise.all([
    prisma.tradeShowLead.count({ where: leadWhere }),
    prisma.contact.count({ where: contactWhere }),
    prisma.opportunity.count({ where: opportunityWhere }),
    prisma.campaignInfluence.count({ where: { AND: [influenceWhere, { voidedAt: null }] } }),
    prisma.campaignInfluence.findMany({ where: influenceWhere, include: {
      tradeShowLead: { select: { id: true, tradeShowId: true, firstName: true, lastName: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      opportunity: { select: { id: true, name: true, ownerId: true } },
      capturedBy: { select: { firstName: true, lastName: true } },
    }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 }),
    prisma.tradeShowLead.findMany({ where: leadWhere, select: { id: true, tradeShowId: true, firstName: true, lastName: true }, orderBy: { id: 'desc' }, take: 6 }),
    prisma.contact.findMany({ where: contactWhere, select: { id: true, firstName: true, lastName: true }, orderBy: { id: 'desc' }, take: 6 }),
    canOpenOpportunity ? prisma.opportunity.findMany({ where: opportunityWhere, select: { id: true, name: true }, orderBy: { id: 'desc' }, take: 6 }) : Promise.resolve([]),
  ]);
  const visibleInfluences = influences.slice(0, 20);
  const details = [
    ['Status', campaignStatusLabel(campaign.status, campaign.archivedAt)],
    ...(campaign.year ? [['Year', String(campaign.year)]] : []),
    ...(campaign.category ? [['Category', campaign.category]] : []),
    ...(campaign.startDate ? [['Start date', date(campaign.startDate)]] : []),
    ...(campaign.endDate ? [['End date', date(campaign.endDate)]] : []),
  ];
  return <Content>
    <PageHeader eyebrow="Campaigns" title={campaign.name} description={[campaignStatusLabel(campaign.status, campaign.archivedAt), campaign.year, campaign.category, campaign.startDate && date(campaign.startDate), campaign.endDate && date(campaign.endDate)].filter(Boolean).join(' · ')} action={<div className="flex flex-wrap gap-2">{manage && <Link className="btn-primary" href={`/marketing/campaigns/${id}/edit`}>Edit Campaign</Link>}<Link className="btn-secondary" href="/marketing/campaigns">All Campaigns</Link></div>}/>
    <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Trade Show Leads', leadCount], ['Contacts', contactCount], ['Opportunities', opportunityCount], ['Active Influences', activeCount]].map(([label, count]) => <div key={label} className="panel p-4"><p className="text-xs font-medium text-slate-600">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-950">{count}</p></div>)}</div>
    <p className="mb-5 text-xs text-slate-500">Counts reflect current links and active Campaign Influences; they do not assign revenue credit.</p>
    <section className="panel p-5"><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold">Campaign Details</h2>{manage && <form action={setCampaignArchive}><input type="hidden" name="id" value={id}/><input type="hidden" name="archive" value={campaign.archivedAt ? 'false' : 'true'}/><button className="text-sm font-medium text-orange-800 underline">{campaign.archivedAt ? 'Reactivate' : 'Archive'} Campaign</button></form>}</div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{details.map(([label, value]) => <div key={label}><dt className="label">{label}</dt><dd className="text-sm">{value}</dd></div>)}{campaign.tradeShow && <div><dt className="label">Related Trade Show</dt><dd className="text-sm"><Link className={linkClass} href={`/trade-shows/${campaign.tradeShow.id}`}>{campaign.tradeShow.name}</Link></dd></div>}</dl>
      {campaign.description && <div className="mt-4"><h3 className="label">Description</h3><p className="whitespace-pre-wrap text-sm">{campaign.description}</p></div>}
    </section>
    <section className="panel mt-5 p-5"><h2 className="text-lg font-semibold">Campaign Influence</h2><p className="mt-1 text-xs text-slate-500">Recent activity, newest first</p>
      {visibleInfluences.length ? <ul className="mt-3 divide-y text-sm">{visibleInfluences.map(touch => <li key={touch.id} className="flex flex-wrap items-start justify-between gap-2 py-3"><div>
        <p className="font-medium">{touch.tradeShowLead ? <>Trade Show Lead · <Link className={linkClass} href={`/trade-shows/${touch.tradeShowLead.tradeShowId}/leads/${touch.tradeShowLead.id}`}>{touch.tradeShowLead.firstName} {touch.tradeShowLead.lastName}</Link></> : touch.contact ? <>Contact · <Link className={linkClass} href={`/contacts/${touch.contact.id}`}>{touch.contact.firstName} {touch.contact.lastName}</Link></> : touch.opportunity ? <>Opportunity · {canOpenOpportunity ? <Link className={linkClass} href={`/opportunities/${touch.opportunity.id}`}>{touch.opportunity.name}</Link> : 'Influenced Opportunity'}</> : 'Linked record unavailable'}{touch.voidedAt && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Voided</span>}</p>
        <p className="mt-1 text-xs text-slate-600">{influenceSourceLabel(touch.sourceContext)}{touch.capturedBy ? ` · Captured by ${touch.capturedBy.firstName} ${touch.capturedBy.lastName}` : ''}{touch.voidedAt ? ` · Voided ${time(touch.voidedAt)}` : ''}</p>
      </div><time className="text-xs text-slate-600" dateTime={touch.occurredAt.toISOString()}>{time(touch.occurredAt)}</time></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No Campaign Influences have been recorded yet.</p>}
      <div className="mt-3 flex gap-3 text-sm">{page > 1 && <Link className={linkClass} href={`/marketing/campaigns/${id}?page=${page - 1}`}>Newer</Link>}{influences.length > 20 && <Link className={linkClass} href={`/marketing/campaigns/${id}?page=${page + 1}`}>Older</Link>}</div>
    </section>
    <div className="mt-5 grid gap-5 lg:grid-cols-3">
      <section className="panel p-5"><h2 className="font-semibold">Influenced Trade Show Leads <span className="text-slate-500">({leadCount})</span></h2>{leads.length ? <ul className="mt-2 space-y-2 text-sm">{leads.map(lead => <li key={lead.id}><Link className={linkClass} href={`/trade-shows/${lead.tradeShowId}/leads/${lead.id}`}>{lead.firstName} {lead.lastName}</Link></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No Trade Show Leads are currently influenced by this Campaign.</p>}{leadCount > leads.length && <p className="mt-2 text-xs text-slate-500">Showing recent {leads.length}</p>}</section>
      <section className="panel p-5"><h2 className="font-semibold">Influenced Contacts <span className="text-slate-500">({contactCount})</span></h2>{contacts.length ? <ul className="mt-2 space-y-2 text-sm">{contacts.map(contact => <li key={contact.id}><Link className={linkClass} href={`/contacts/${contact.id}`}>{contact.firstName} {contact.lastName}</Link></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No Contacts are currently influenced by this Campaign.</p>}{contactCount > contacts.length && <p className="mt-2 text-xs text-slate-500">Showing recent {contacts.length}</p>}</section>
      <section className="panel p-5"><h2 className="font-semibold">Influenced Opportunities <span className="text-slate-500">({opportunityCount})</span></h2>{!canOpenOpportunity && opportunityCount ? <p className="mt-2 text-sm text-slate-500">Opportunity details are available to Sales users.</p> : opportunities.length ? <ul className="mt-2 space-y-2 text-sm">{opportunities.map(opportunity => <li key={opportunity.id}>{canOpenOpportunity ? <Link className={linkClass} href={`/opportunities/${opportunity.id}`}>{opportunity.name}</Link> : opportunity.name}</li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No Opportunities are currently influenced by this Campaign.</p>}{opportunityCount > opportunities.length && <p className="mt-2 text-xs text-slate-500">Showing recent {opportunities.length}</p>}</section>
    </div>
  </Content>;
}
