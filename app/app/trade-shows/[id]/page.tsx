import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { TradeShowArchiveControl } from '@/components/trade-show-form';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { tradeShowKpis, tradeShowLeadReadWhere, tradeShowReadWhere } from '@/lib/trade-shows';

export const dynamic = 'force-dynamic';
export default async function TradeShowPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const show = await prisma.tradeShow.findFirst({
    where: { AND: [{ id }, tradeShowReadWhere(actor)] },
    include: {
      marketingOwner: { select: { firstName: true, lastName: true } },
      leads: { where: tradeShowLeadReadWhere(actor), select: { id: true, firstName: true, lastName: true, sourceCompany: true, assignedSalesRepUserId: true, status: true, assignedSalesRep: { select: { firstName: true, lastName: true } } }, orderBy: { id: 'desc' }, take: 100 },
      imports: { select: { id: true, sourceFileName: true, sourceSheet: true, uploadedAt: true, rowCount: true, createdCount: true, existingCount: true, skippedCount: true }, orderBy: { uploadedAt: 'desc' }, take: 20 },
    },
  });
  if (!show) notFound();
  const kpiRows = await prisma.tradeShowLead.findMany({ where: { AND: [{ tradeShowId: id }, tradeShowLeadReadWhere(actor)] }, select: { assignedSalesRepUserId: true, status: true } });
  const kpi = tradeShowKpis(kpiRows);
  const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? '—';
  return <Content><PageHeader eyebrow="Trade Shows" title={show.name} description={`Trade Show #${show.id}`} action={<div className="flex gap-2"><Link className="btn-secondary" href="/trade-shows">All Trade Shows</Link>{can(actor, 'trade-shows.manage') && !show.archivedAt && <Link className="btn-primary" href={`/trade-shows/${id}/edit`}>Edit Trade Show</Link>}</div>}/>
    <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 p-5"><span className="text-sm text-slate-600">{show.archivedAt ? 'Archived' : 'Active'}</span>{can(actor, 'trade-shows.manage') && <TradeShowArchiveControl id={id} archived={!!show.archivedAt}/>}</div>
    <section className="panel mb-5 p-6"><h2 className="mb-4 text-lg font-semibold">Event</h2><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div><dt className="label">Dates</dt><dd>{date(show.startDate)}{show.endDate ? ` – ${date(show.endDate)}` : ''}</dd></div><div><dt className="label">Location</dt><dd>{show.location ?? '—'}</dd></div><div><dt className="label">Timezone</dt><dd>{show.timezone ?? '—'}</dd></div><div><dt className="label">Marketing Owner</dt><dd>{show.marketingOwner ? `${show.marketingOwner.firstName} ${show.marketingOwner.lastName}` : 'Unassigned'}</dd></div><div className="sm:col-span-2"><dt className="label">Description / Notes</dt><dd className="whitespace-pre-wrap">{show.description ?? '—'}</dd></div></dl></section>
    <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries({ 'Total Leads': kpi.total, Assigned: kpi.assigned, Contacted: kpi.contacted, Qualified: kpi.qualified, Converted: kpi.converted }).map(([label, value]) => <div className="panel p-4" key={label}><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}</section>
    <section className="panel mb-5 overflow-x-auto"><div className="p-5"><h2 className="text-lg font-semibold">Leads</h2><p className="mt-1 text-sm text-slate-600">Captured leads and their follow-up outcomes.</p></div><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-y bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Lead','Company','Assigned Sales Rep','Status'].map(label => <th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{show.leads.map(lead => <tr key={lead.id}><td className="px-4 py-3"><Link className="font-medium text-orange-800" href={`/trade-shows/${id}/leads/${lead.id}`}>{lead.firstName} {lead.lastName}</Link></td><td className="px-4 py-3">{lead.sourceCompany ?? '—'}</td><td className="px-4 py-3">{lead.assignedSalesRep ? `${lead.assignedSalesRep.firstName} ${lead.assignedSalesRep.lastName}` : 'Unassigned'}</td><td className="px-4 py-3">{lead.status}</td></tr>)}</tbody></table>{!show.leads.length && <p className="p-8 text-center text-sm text-slate-500">No leads imported for this Trade Show yet.</p>}{kpi.total > show.leads.length && <p className="p-4 text-sm text-slate-500">Showing the newest 100 leads.</p>}</section>
    <section className="panel p-5"><h2 className="text-lg font-semibold">Import History</h2>{show.imports.length ? <ul className="mt-3 divide-y">{show.imports.map(item => <li className="py-3 text-sm" key={item.id}><strong>{item.sourceFileName}</strong> · {item.sourceSheet} · {item.uploadedAt.toISOString().slice(0,16).replace('T',' ')} UTC · {item.rowCount} rows · {item.createdCount} new · {item.existingCount} existing · {item.skippedCount} skipped</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No imports yet. Spreadsheet upload and review will be added in Stage 2.</p>}</section>
  </Content>;
}
