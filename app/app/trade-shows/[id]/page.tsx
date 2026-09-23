import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { TradeShowArchiveControl } from '@/components/trade-show-form';
import { TableScroll } from '@/components/table-scroll';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { tradeShowKpis, tradeShowLeadReadWhere, tradeShowReadWhere } from '@/lib/trade-shows';
import { tradeShowTimezoneLabel } from '@/lib/trade-show-timezones';
import type { TradeShowImportFormat, TradeShowLeadStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
const leadStatusClasses: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  CONTACTED: 'bg-blue-50 text-blue-700',
  QUALIFIED: 'bg-amber-50 text-amber-800',
  CONVERTED: 'bg-emerald-50 text-emerald-700',
  DISQUALIFIED: 'bg-red-50 text-red-700',
};
const leadStatusLabels: Record<TradeShowLeadStatus, string> = { NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', CONVERTED: 'Converted', DISQUALIFIED: 'Disqualified' };
const sourceFormatLabels: Record<TradeShowImportFormat, string> = { NRA_NRF: 'NRA / NRF', XPRESSLEADS_MODEX: 'MODEX / XPressLeads' };
export default async function TradeShowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{q?:string;rep?:string;status?:string;account?:string;contact?:string;followUp?:string}> }) {
  const actor = await currentUser();
  const id = Number((await params).id);
  const filters = await searchParams;
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const repId=Number(filters.rep); const statuses=['NEW','CONTACTED','QUALIFIED','CONVERTED','DISQUALIFIED'];
  const leadFilter={AND:[tradeShowLeadReadWhere(actor),...(filters.q?[{OR:[{firstName:{contains:filters.q,mode:'insensitive' as const}},{lastName:{contains:filters.q,mode:'insensitive' as const}},{sourceCompany:{contains:filters.q,mode:'insensitive' as const}},{email:{contains:filters.q,mode:'insensitive' as const}}]}]:[]),...(Number.isSafeInteger(repId)&&repId>0?[{assignedSalesRepUserId:repId}]:[]),...(filters.status&&statuses.includes(filters.status)?[{status:filters.status as 'NEW'|'CONTACTED'|'QUALIFIED'|'CONVERTED'|'DISQUALIFIED'}]:[]),...(filters.account==='unresolved'?[{accountId:null}]:[]),...(filters.contact==='unresolved'?[{contactId:null}]:[]),...(filters.followUp==='overdue'?[{followUpAt:{lt:new Date()}}]:filters.followUp==='scheduled'?[{followUpAt:{not:null}}]:filters.followUp==='none'?[{followUpAt:null}]:[])]};
  const [show,reps] = await Promise.all([prisma.tradeShow.findFirst({
    where: { AND: [{ id }, tradeShowReadWhere(actor)] },
    include: {
      marketingOwner: { select: { firstName: true, lastName: true } },
      leads: { where: leadFilter, select: { id: true, firstName: true, lastName: true, title: true, sourceCompany: true, email: true, phone: true, followUpAt: true, assignedSalesRepUserId: true, status: true, assignedSalesRep: { select: { firstName: true, lastName: true } }, account:{select:{name:true}},contact:{select:{firstName:true,lastName:true}},convertedOpportunity:{select:{id:true}} }, orderBy: { id: 'desc' }, take: 100 },
      imports: { select: { id: true, format:true, sourceFileName: true, sourceSheet: true, fileSha256:true, uploadedAt: true, rowCount: true, createdCount: true, existingCount: true, skippedCount: true,uploadedBy:{select:{firstName:true,lastName:true}} }, orderBy: { uploadedAt: 'desc' }, take: 20 },
    },
  }),prisma.user.findMany({where:{active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}},select:{id:true,firstName:true,lastName:true},orderBy:{firstName:'asc'}})]);
  if (!show) notFound();
  const kpiRows = await prisma.tradeShowLead.findMany({ where: { AND: [{ tradeShowId: id }, tradeShowLeadReadWhere(actor)] }, select: { assignedSalesRepUserId: true, status: true } });
  const kpi = tradeShowKpis(kpiRows);
  const date = (value: Date | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(value) : '—';
  const dateTime = (value: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(value);
  return <Content><PageHeader eyebrow="Trade Shows" title={show.name} description={`Trade Show #${show.id}`} action={<div className="flex flex-wrap justify-end gap-2"><Link className="btn-secondary" href="/trade-shows">All Trade Shows</Link>{can(actor, 'trade-shows.manage') && !show.archivedAt && <><Link className="btn-secondary" href={`/trade-shows/${id}/import`}>Import Leads</Link><Link className="btn-primary" href={`/trade-shows/${id}/edit`}>Edit Trade Show</Link></>}</div>}/>
    <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 p-5"><span className="text-sm text-slate-600">{show.archivedAt ? 'Archived' : 'Active'}</span>{can(actor, 'trade-shows.manage') && <TradeShowArchiveControl id={id} archived={!!show.archivedAt}/>}</div>
    <section className="panel mb-5 p-5 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Event</h2><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div className="min-w-0"><dt className="label">Dates</dt><dd>{date(show.startDate)}{show.endDate && show.endDate.getTime() !== show.startDate?.getTime() ? ` – ${date(show.endDate)}` : ''}</dd></div><div className="min-w-0"><dt className="label">Location</dt><dd className="break-words">{show.location ?? '—'}</dd></div><div className="min-w-0"><dt className="label">Timezone</dt><dd>{tradeShowTimezoneLabel(show.timezone)}</dd></div><div className="min-w-0"><dt className="label">Marketing Owner</dt><dd className="break-words">{show.marketingOwner ? `${show.marketingOwner.firstName} ${show.marketingOwner.lastName}` : '—'}</dd></div><div className="min-w-0 sm:col-span-2"><dt className="label">Description / Notes</dt><dd className="whitespace-pre-wrap break-words">{show.description ?? '—'}</dd></div></dl></section>
    <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries({ 'Total Leads': kpi.total, Assigned: kpi.assigned, Contacted: kpi.contacted, Qualified: kpi.qualified, Converted: kpi.converted }).map(([label, value]) => <div className="panel p-4" key={label}><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}</section>
    <section className="panel mb-5 min-w-0 max-w-full">
      <div className="p-5">
        <h2 className="text-lg font-semibold">Leads</h2>
        <p className="mt-1 text-sm text-slate-600">Captured leads and their follow-up outcomes.</p>
        <form className="mt-4 rounded-md border border-orange-200 bg-orange-50/60 p-3" method="get" aria-label="Filter Trade Show leads">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <div><label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="lead-search">Search</label><input className="field h-9 min-w-0 px-2.5 py-1.5 text-sm" id="lead-search" name="q" defaultValue={filters.q ?? ''} placeholder="Name, company, or email"/></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="lead-rep">Assigned Sales Rep</label><select className="field h-9 min-w-0 px-2.5 py-1.5 text-sm" id="lead-rep" name="rep" defaultValue={filters.rep??''}><option value="">All reps</option>{reps.map(rep=><option key={rep.id} value={rep.id}>{rep.firstName} {rep.lastName}</option>)}</select></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="lead-status">Status</label><select className="field h-9 min-w-0 px-2.5 py-1.5 text-sm" id="lead-status" name="status" defaultValue={filters.status??''}><option value="">All statuses</option>{statuses.map(status=><option key={status} value={status}>{leadStatusLabels[status as TradeShowLeadStatus]}</option>)}</select></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="lead-account">Account</label><select className="field h-9 min-w-0 px-2.5 py-1.5 text-sm" id="lead-account" name="account" defaultValue={filters.account??''}><option value="">All accounts</option><option value="unresolved">Not linked</option></select></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="lead-contact">Contact</label><select className="field h-9 min-w-0 px-2.5 py-1.5 text-sm" id="lead-contact" name="contact" defaultValue={filters.contact??''}><option value="">All contacts</option><option value="unresolved">Not linked</option></select></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="lead-follow-up">Follow-Up</label><select className="field h-9 min-w-0 px-2.5 py-1.5 text-sm" id="lead-follow-up" name="followUp" defaultValue={filters.followUp??''}><option value="">All follow-ups</option><option value="overdue">Overdue</option><option value="scheduled">Scheduled</option><option value="none">None</option></select></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2"><button className="btn-primary h-9 px-3 py-1.5" type="submit">Filter</button><Link className="btn-secondary h-9 px-3 py-1.5" href={`/trade-shows/${id}`}>Clear</Link></div>
        </form>
      </div>
      <TableScroll label="Trade Show leads">
        <table className="w-full min-w-[960px] table-fixed text-left text-sm">
          <colgroup>{['17%','18%','19%','14%','11%','21%'].map((width,index)=><col key={index} style={{width}}/>)}</colgroup>
          <thead className="border-y bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr>{['Lead','Company','Contact','Assigned Sales Rep','Status','CRM / Follow-Up'].map(label => <th className="px-3 py-2.5" key={label}>{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{show.leads.map(lead => {
            const linkedCompany = lead.account?.name;
            const sourceCompanyDiffers = linkedCompany && lead.sourceCompany && linkedCompany.toLowerCase() !== lead.sourceCompany.toLowerCase();
            return <tr className="align-top even:bg-slate-50/60 hover:bg-orange-50/50 focus-within:bg-orange-50/50" key={lead.id}>
              <td className="px-3 py-2.5"><Link className="font-semibold text-orange-800 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600" href={`/trade-shows/${id}/leads/${lead.id}`}>{lead.firstName} {lead.lastName}</Link>{lead.title && <div className="mt-0.5 line-clamp-2 break-words text-xs leading-4 text-slate-500">{lead.title}</div>}</td>
              <td className="px-3 py-2.5"><div className="line-clamp-3 break-words leading-5">{linkedCompany ?? lead.sourceCompany ?? '—'}</div>{sourceCompanyDiffers && <div className="mt-0.5 line-clamp-1 break-words text-xs leading-4 text-slate-500">Source: {lead.sourceCompany}</div>}</td>
              <td className="px-3 py-2.5"><div className="line-clamp-2 break-all leading-5">{lead.email??'—'}</div>{lead.phone && <div className="mt-0.5 break-words text-xs leading-4 text-slate-500">{lead.phone}</div>}</td>
              <td className="break-words px-3 py-2.5 leading-5">{lead.assignedSalesRep ? `${lead.assignedSalesRep.firstName} ${lead.assignedSalesRep.lastName}` : <span className="text-slate-500">Unassigned</span>}</td>
              <td className="px-3 py-2.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 ${leadStatusClasses[lead.status] ?? 'bg-slate-100 text-slate-700'}`}>{leadStatusLabels[lead.status]}</span></td>
              <td className="px-3 py-2.5 text-xs leading-5"><div className="break-words"><span className="font-semibold text-slate-600">Account:</span> {lead.account?.name??<span className="text-amber-700">Not linked</span>}</div><div className="break-words"><span className="font-semibold text-slate-600">Contact:</span> {lead.contact?`${lead.contact.firstName} ${lead.contact.lastName}`:<span className="text-amber-700">Not linked</span>}</div><div><span className="font-semibold text-slate-600">Follow-Up:</span> {lead.followUpAt ? date(lead.followUpAt) : '—'}</div>{lead.convertedOpportunity && <div>{can(actor, 'sales.read') ? <Link className="font-semibold text-orange-800 underline underline-offset-2" href={`/opportunities/${lead.convertedOpportunity.id}`}>Converted Opportunity</Link> : <span className="font-semibold text-emerald-700">Converted</span>}</div>}</td>
            </tr>;
          })}</tbody>
        </table>
      </TableScroll>
      {!show.leads.length && <p className="p-8 text-center text-sm text-slate-500">No leads match these filters.</p>}
    </section>
    <section className="panel p-5"><h2 className="text-lg font-semibold">Import History</h2>{show.imports.length ? <ul className="mt-3 divide-y">{show.imports.map(item => <li className="min-w-0 py-3 text-sm" key={item.id}><strong className="block break-all text-slate-900">{item.sourceFileName}</strong><div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-slate-600"><span>{sourceFormatLabels[item.format]}</span><span>Sheet: {item.sourceSheet}</span><span>Uploaded by {item.uploadedBy.firstName} {item.uploadedBy.lastName}</span><span>{dateTime(item.uploadedAt)}</span></div><div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500"><span>{item.rowCount} rows</span><span>{item.createdCount} new</span><span>{item.existingCount} existing</span><span>{item.skippedCount} skipped</span></div></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No confirmed imports yet.</p>}</section>
  </Content>;
}
