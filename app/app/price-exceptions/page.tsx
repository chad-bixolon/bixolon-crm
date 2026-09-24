import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { listPriceExceptions, priceExceptionHref, type PriceExceptionFilters } from '@/lib/price-exceptions';
import { priceExceptionStatusLabel } from '@/lib/price-exception-labels';

export const dynamic='force-dynamic';
const Party=({account,raw}:{account:{id:number;name:string}|null;raw:string|null})=>account?<Link className="text-orange-800 underline" href={`/accounts/${account.id}`}>{account.name}</Link>:raw?<span title="Unresolved source name">{raw} <span className="text-amber-700">?</span></span>:<>—</>;

export default async function PriceExceptionsPage({searchParams}:{searchParams:Promise<PriceExceptionFilters>}) {
  const actor=await requirePermission('pricing.read'),filters=await searchParams;
  const {rows,count,page,pages,salesReps}=await listPriceExceptions(prisma,filters,actor);
  const control='field filter-control';
  return <Content>
    <PageHeader eyebrow="Commercial history" title="Price Exceptions" description="Finalized Price Exception records imported from BIXOLON operational sources."/>
    <form className="panel filter-panel filter-grid mb-5" method="get" aria-label="Filter Price Exceptions">
      <label className="label">Search<input className={control} name="q" defaultValue={filters.q??''} placeholder="PE # or SKU"/></label>
      <label className="label">Status<select className={control} name="status" defaultValue={filters.status??''}><option value="">All</option><option>ACTIVE</option><option>EXPIRED</option><option>ARCHIVED</option></select></label>
      <label className="label">Distributor / OEM<input className={control} name="distributor" defaultValue={filters.distributor??''}/></label>
      <label className="label">VAR / ISV<input className={control} name="varName" defaultValue={filters.varName??''}/></label>
      <label className="label">End User<input className={control} name="endUser" defaultValue={filters.endUser??''}/></label>
      <label className="label">Expiration<select className={control} name="expiration" defaultValue={filters.expiration??''}><option value="">All</option><option value="expired">Past date</option><option value="future">Current/future</option><option value="none">No date</option></select></label>
      <label className="label">Resolution Status<select className={control} name="unresolved" defaultValue={filters.unresolved??''}><option value="">All</option><option value="yes">Only unresolved</option></select></label>
      {actor.role!=='SALES'&&<label className="label">BIXOLON Sales Rep<select className={control} name="salesRep" defaultValue={filters.salesRep??''}><option value="">All Sales Reps</option><option value="unassigned">Unassigned / Legacy</option>{salesReps.map(rep=><option key={rep.id} value={rep.id}>{rep.firstName} {rep.lastName}{!rep.active||rep.archivedAt?' (inactive)':''}</option>)}</select></label>}
      <div className="filter-actions"><button className="btn-filter-primary">Apply</button><Link className="btn-filter-secondary" href="/price-exceptions">Clear</Link></div>
    </form>
    <div className="panel overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">PE #</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">BIXOLON Sales Rep</th><th className="px-4 py-3">Distributor / OEM</th><th className="px-4 py-3">VAR / ISV</th><th className="px-4 py-3">End User</th><th className="px-4 py-3">Expiration</th><th className="px-4 py-3">Lines</th></tr></thead><tbody className="divide-y">{rows.map(row=>{const unresolved=(!row.distributorAccountId&&row.distributorSourceName)||(!row.varAccountId&&row.varSourceName)||(!row.endUserAccountId&&row.endUserSourceName)||row.lines.length>0;return <tr key={row.id} className="even:bg-slate-50/60 hover:bg-orange-50/50 focus-within:bg-orange-50/50"><td className="px-4 py-3"><Link className="font-semibold text-orange-800" href={`/price-exceptions/${row.id}`}>{row.peCode??'(unnumbered)'}</Link>{unresolved&&<span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Unresolved</span>}</td><td className="px-4 py-3">{priceExceptionStatusLabel(row.status)}</td><td className="px-4 py-3">{row.assignedSalesRepUser?`${row.assignedSalesRepUser.firstName} ${row.assignedSalesRepUser.lastName}`:row.sourceType==='LEGACY_WORKBOOK'?'Legacy / Unassigned':'Unassigned'}</td><td className="px-4 py-3"><Party account={row.distributorAccount} raw={row.distributorSourceName}/></td><td className="px-4 py-3"><Party account={row.varAccount} raw={row.varSourceName}/></td><td className="px-4 py-3"><Party account={row.endUserAccount} raw={row.endUserSourceName}/></td><td className="px-4 py-3">{row.expirationDate?.toISOString().slice(0,10)??'—'}</td><td className="px-4 py-3">{row._count.lines}</td></tr>})}</tbody></table>{!rows.length&&<p className="p-8 text-center text-sm text-slate-500">No Price Exceptions match these filters.</p>}</div>
    <div className="mt-4 flex justify-between text-sm text-slate-600"><span>{count} Price Exceptions · Page {page} of {pages}</span><div className="flex gap-2">{page>1&&<Link className="btn-secondary" href={priceExceptionHref(filters,page-1)}>Previous</Link>}{page<pages&&<Link className="btn-secondary" href={priceExceptionHref(filters,page+1)}>Next</Link>}</div></div>
  </Content>;
}
