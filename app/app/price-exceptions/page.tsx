import { NAV_CATEGORIES } from '../../lib/navigation-categories';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { listPriceExceptions, priceExceptionHref, type PriceExceptionFilters } from '@/lib/price-exceptions';
import { priceExceptionStatusLabel } from '@/lib/price-exception-labels';
import { priceExceptionListSummary } from '@/lib/price-exception-list-summary';
import { expirationOptions } from '@/lib/price-exception-expiration';

export const dynamic='force-dynamic';
const Party=({account,raw}:{account:{id:number;name:string}|null;raw:string|null})=>account?<Link className="block max-w-44 truncate text-orange-800 underline" title={account.name} href={`/accounts/${account.id}`}>{account.name}</Link>:raw?<span className="block max-w-44 truncate" title={`Unresolved: ${raw}`}>{raw} <span className="text-amber-700">?</span></span>:<>—</>;

export default async function PriceExceptionsPage({searchParams}:{searchParams:Promise<PriceExceptionFilters>}) {
  const actor=await requirePermission('pricing.read'),filters=await searchParams;
  const {rows,count,page,pages,salesReps}=await listPriceExceptions(prisma,filters,actor);
  const control='field filter-control';
  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.catalogPricing} title="Price Exceptions" description="Finalized Price Exception records imported from BIXOLON operational sources." action={<Link className="btn-primary" href="/price-exceptions/lookup">Find a valid PE</Link>}/>
    <form className="panel filter-panel filter-grid mb-5" method="get" aria-label="Filter Price Exceptions">
      <label className="label">Search<input className={control} name="q" defaultValue={filters.q??''} placeholder="PE # or SKU"/></label>
      <label className="label">Status<select className={control} name="status" defaultValue={filters.status??''}><option value="">Current</option><option value="ALL">All</option><option>ACTIVE</option><option>EXPIRED</option><option>ARCHIVED</option></select></label>
      <label className="label">Distributor / OEM<input className={control} name="distributor" defaultValue={filters.distributor??''}/></label>
      <label className="label">VAR / ISV<input className={control} name="varName" defaultValue={filters.varName??''}/></label>
      <label className="label">End User<input className={control} name="endUser" defaultValue={filters.endUser??''}/></label>
      <label className="label">Expiration<select className={control} name="expiration" defaultValue={filters.expiration??'all'}>{expirationOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="future">Current/future</option></select></label>
      <label className="label">Resolution Status<select className={control} name="unresolved" defaultValue={filters.unresolved??''}><option value="">All</option><option value="yes">Only unresolved</option></select></label>
      {actor.role!=='SALES'&&<label className="label">BIXOLON Sales Rep<select className={control} name="salesRep" defaultValue={filters.salesRep??''}><option value="">All Sales Reps</option><option value="unassigned">Unassigned / Legacy</option>{salesReps.map(rep=><option key={rep.id} value={rep.id}>{rep.firstName} {rep.lastName}{!rep.active||rep.archivedAt?' (inactive)':''}</option>)}</select></label>}
      <div className="filter-actions"><button className="btn-filter-primary">Apply</button><Link className="btn-filter-secondary" href="/price-exceptions">Clear</Link></div>
    </form>
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[1200px] text-left text-sm" aria-label="Price Exceptions">
        <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>
          <th scope="col" className="w-32 whitespace-nowrap px-3 py-2">PE #</th>
          <th scope="col" className="w-20 whitespace-nowrap px-3 py-2">Status</th>
          <th scope="col" className="w-32 px-3 py-2">BIXOLON Sales Rep</th>
          <th scope="col" className="w-44 px-3 py-2">Distributor / OEM</th>
          <th scope="col" className="w-40 px-3 py-2">VAR / ISV</th>
          <th scope="col" className="w-40 px-3 py-2">End User</th>
          <th scope="col" className="w-48 px-3 py-2">Product / SKU</th>
          <th scope="col" className="w-36 whitespace-nowrap px-3 py-2">MOQ / tiers</th>
          <th scope="col" className="w-28 whitespace-nowrap px-3 py-2">Expiration</th>
        </tr></thead>
        <tbody className="divide-y">{rows.map(row=>{
          const unresolved=(!row.distributorAccountId&&row.distributorSourceName)||(!row.varAccountId&&row.varSourceName)||(!row.endUserAccountId&&row.endUserSourceName)||row.lines.some(line=>!line.productSku);
          const summary=priceExceptionListSummary(row.lines);
          return <tr key={row.id} className="even:bg-slate-50/60 hover:bg-orange-50/50 focus-within:bg-orange-50/50">
            <td className="whitespace-nowrap px-3 py-2 align-top"><Link className="font-semibold text-orange-800" href={`/price-exceptions/${row.id}`}>{row.peCode??'(unnumbered)'}</Link>{unresolved&&<span className="mt-0.5 block w-fit rounded bg-amber-100 px-1 text-[11px] leading-4 text-amber-900">Unresolved</span>}</td>
            <td className="whitespace-nowrap px-3 py-2 align-top">{priceExceptionStatusLabel(row.status)}</td>
            <td className="px-3 py-2 align-top"><span className="block max-w-32 truncate" title={row.assignedSalesRepUser?`${row.assignedSalesRepUser.firstName} ${row.assignedSalesRepUser.lastName}`:undefined}>{row.assignedSalesRepUser?`${row.assignedSalesRepUser.firstName} ${row.assignedSalesRepUser.lastName}`:row.sourceType==='LEGACY_WORKBOOK'?'Legacy / Unassigned':'Unassigned'}</span></td>
            <td className="px-3 py-2 align-top"><Party account={row.distributorAccount} raw={row.distributorSourceName}/></td>
            <td className="px-3 py-2 align-top"><Party account={row.varAccount} raw={row.varSourceName}/></td>
            <td className="px-3 py-2 align-top"><Party account={row.endUserAccount} raw={row.endUserSourceName}/></td>
            <td className="px-3 py-2 align-top">{summary.product?<div className="max-w-48 leading-5">{summary.product.product&&<span className="block truncate font-medium" title={summary.product.product}>{summary.product.product}</span>}<span className="block truncate font-mono text-xs" title={summary.product.sku}>{summary.product.sku}</span>{summary.skuCount>1&&<span className="block text-xs text-slate-500">+{summary.skuCount-1} more SKU{summary.skuCount===2?'':'s'}</span>}</div>:<span>—</span>}</td>
            <td className="whitespace-nowrap px-3 py-2 align-top font-medium" title={summary.tierTitle||undefined}>{summary.tierText}</td>
            <td className="whitespace-nowrap px-3 py-2 align-top">{row.expirationDate?.toISOString().slice(0,10)??'—'}</td>
          </tr>})}</tbody>
      </table>
      {!rows.length&&<p className="p-8 text-center text-sm text-slate-500">No Price Exceptions match these filters.</p>}
    </div>
    <div className="mt-4 flex justify-between text-sm text-slate-600"><span>{count} Price Exceptions · Page {page} of {pages}</span><div className="flex gap-2">{page>1&&<Link className="btn-secondary" href={priceExceptionHref(filters,page-1)}>Previous</Link>}{page<pages&&<Link className="btn-secondary" href={priceExceptionHref(filters,page+1)}>Next</Link>}</div></div>
  </Content>;
}
