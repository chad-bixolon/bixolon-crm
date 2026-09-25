import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { TradeShowLeadStatus } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { TableScroll } from '@/components/table-scroll';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { canViewSalesLeadQueue, salesLeadQueueWhere } from '@/lib/trade-show-leads';

export const dynamic = 'force-dynamic';
const statusLabels: Record<TradeShowLeadStatus,string> = {NEW:'New',CONTACTED:'Contacted',QUALIFIED:'Qualified',CONVERTED:'Converted',DISQUALIFIED:'Disqualified'};
type Filters = { view?: string; status?: string; tradeShowId?: string };

export default async function MyTradeShowLeadsPage({searchParams}:{searchParams:Promise<Filters>}) {
  const actor = await currentUser();
  if (!canViewSalesLeadQueue(actor)) redirect('/access-denied');
  const filters = await searchParams;
  const where = salesLeadQueueWhere(actor, filters);
  const [leads, shows] = await Promise.all([
    prisma.tradeShowLead.findMany({where,select:{id:true,tradeShowId:true,firstName:true,lastName:true,sourceCompany:true,status:true,productInterest:true,followUpAt:true,lastContactedAt:true,assignedSalesRep:{select:{firstName:true,lastName:true}},tradeShow:{select:{name:true}}},orderBy:[{followUpAt:'asc'},{updatedAt:'desc'},{id:'desc'}]}),
    prisma.tradeShow.findMany({where:{archivedAt:null,leads:{some:{routing:'BIXOLON_SALES',assignedSalesRepUserId:filters.view==='all'&&actor.role!=='SALES'?{not:null}:actor.id}}},select:{id:true,name:true},orderBy:{name:'asc'}}),
  ]);
  const allAllowed=actor.role==='ADMIN'||actor.role==='SALES_MANAGER';
  const date=(value:Date|null)=>value?.toISOString().slice(0,10)??'—';
  return <Content><PageHeader eyebrow="Trade Shows" title="My Trade Show Leads" description="Internal Sales leads assigned for follow-up." action={<Link className="btn-secondary" href="/trade-shows">Trade Shows</Link>}/>
    {allAllowed&&<nav className="mb-4 flex gap-2" aria-label="Lead ownership"><Link className={filters.view==='all'?'btn-filter-secondary':'btn-filter-primary'} href="/trade-shows/my-leads">My Leads</Link><Link className={filters.view==='all'?'btn-filter-primary':'btn-filter-secondary'} href="/trade-shows/my-leads?view=all">All Assigned Leads</Link></nav>}
    <form className="filter-panel mb-4 rounded-md border" method="get"><div className="filter-grid">{filters.view==='all'&&<input type="hidden" name="view" value="all"/>}<div><label className="label" htmlFor="lead-status">Status</label><select className="field filter-control" id="lead-status" name="status" defaultValue={filters.status??''}><option value="">Actionable</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><div><label className="label" htmlFor="lead-show">Trade Show</label><select className="field filter-control" id="lead-show" name="tradeShowId" defaultValue={filters.tradeShowId??''}><option value="">All Trade Shows</option>{shows.map(show=><option key={show.id} value={show.id}>{show.name}</option>)}</select></div></div><div className="filter-actions mt-3 justify-end"><button className="btn-filter-primary">Filter</button><Link className="btn-filter-secondary" href={filters.view==='all'?'/trade-shows/my-leads?view=all':'/trade-shows/my-leads'}>Clear</Link></div></form>
    <section className="panel min-w-0 max-w-full overflow-hidden"><TableScroll label="My Trade Show Leads"><table className="w-full min-w-[860px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Lead','Company','Trade Show','Status','Product Interest','Assigned Rep','Follow-Up'].map(label=><th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{leads.map(lead=><tr className="even:bg-slate-50/60 hover:bg-orange-50/50" key={lead.id}><td className="px-4 py-3"><Link className="font-semibold text-orange-800 hover:underline" href={`/trade-shows/${lead.tradeShowId}/leads/${lead.id}`}>{lead.firstName} {lead.lastName}</Link></td><td className="px-4 py-3">{lead.sourceCompany??'—'}</td><td className="px-4 py-3"><Link className="text-orange-800 underline" href={`/trade-shows/${lead.tradeShowId}`}>{lead.tradeShow.name}</Link></td><td className="px-4 py-3">{statusLabels[lead.status]}</td><td className="max-w-64 truncate px-4 py-3">{lead.productInterest??'—'}</td><td className="px-4 py-3">{lead.assignedSalesRep?`${lead.assignedSalesRep.firstName} ${lead.assignedSalesRep.lastName}`:'—'}</td><td className="px-4 py-3">{date(lead.followUpAt)}{lead.lastContactedAt&&<span className="block text-xs text-slate-500">Last contact {date(lead.lastContactedAt)}</span>}</td></tr>)}</tbody></table></TableScroll>{!leads.length&&<p className="p-8 text-center text-sm text-slate-500">No assigned leads match this work queue.</p>}</section>
  </Content>;
}
