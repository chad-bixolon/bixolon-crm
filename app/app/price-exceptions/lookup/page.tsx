import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { listActivePriceExceptionLines, priceExceptionLookupHref, type PriceExceptionLookupFilters } from '@/lib/price-exception-lookup';

export const dynamic = 'force-dynamic';

export default async function PriceExceptionLookupPage({ searchParams }: { searchParams: Promise<PriceExceptionLookupFilters> }) {
  const actor = await requirePermission('pricing.read');
  const filters = await searchParams;
  const { rows, count, page, pages } = await listActivePriceExceptionLines(prisma, actor, filters);
  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.catalogPricing} title="Find a valid Price Exception" description="Search active, unexpired pricing tiers with a linked customer and usable MOQ. Match the Account, SKU, currency, and quantity before creating an Opportunity." action={<Link className="btn-secondary" href="/price-exceptions">All Price Exceptions</Link>}/>
    <form className="panel filter-panel filter-grid mb-5" method="get" aria-label="Find active Price Exceptions">
      {filters.productId && <input type="hidden" name="productId" value={filters.productId}/>}
      {filters.skuId && <input type="hidden" name="skuId" value={filters.skuId}/>}
      {filters.catalogSource && <input type="hidden" name="catalogSource" value={filters.catalogSource}/>}
      <label className="label">Account / customer<input className="field filter-control" name="account" defaultValue={filters.account ?? ''} placeholder="Linked Account name"/></label>
      <label className="label">SKU or Product<input className="field filter-control" name="sku" defaultValue={filters.sku ?? ''} placeholder="Part number or model"/></label>
      <div className="filter-actions"><button className="btn-filter-primary">Search</button><Link className="btn-filter-secondary" href="/price-exceptions/lookup">Clear</Link></div>
    </form>
    {(filters.productId || filters.skuId) && <p className="mb-3 text-sm text-slate-600">Showing Price Exceptions for the selected {filters.skuId ? 'SKU' : 'Product'}. <Link className="text-orange-800 underline" href="/price-exceptions/lookup">Search all SKUs</Link></p>}
    <div className="panel overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">PE #</th><th className="px-4 py-3">Account / customer</th><th className="px-4 py-3">SKU / Product</th><th className="px-4 py-3">MOQ</th><th className="px-4 py-3">Approved price</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Expiration</th></tr></thead><tbody className="divide-y">{rows.map(line => {
      const pe = line.priceException;
      const parties = [
        ['Distributor / OEM', pe.distributorAccount],
        ['VAR / ISV', pe.varAccount],
        ['End User', pe.endUserAccount],
      ] as const;
      return <tr key={line.id} className="even:bg-slate-50/60"><td className="px-4 py-3"><Link className="font-semibold text-orange-800 underline" href={`/price-exceptions/${pe.id}`}>{pe.peCode ?? `PE #${pe.id}`}</Link></td><td className="px-4 py-3">{parties.filter(([, account]) => !!account).map(([role, account]) => <div key={role}><span className="text-xs text-slate-500">{role}: </span><Link className="text-orange-800 underline" href={`/accounts/${account!.id}`}>{account!.name}</Link>{(account!.status !== 'ACTIVE' || account!.archivedAt) && <span className="ml-1 text-xs text-amber-800">(inactive)</span>}</div>)}</td><td className="px-4 py-3"><Link className="text-orange-800 underline" href={`/products/${line.productSku!.product.id}/edit`}>{line.productSku!.partNumber}</Link><div className="text-xs text-slate-500">{line.productSku!.product.name}</div></td><td className="px-4 py-3">{line.sourceQuantity!.toString()}{line.sourceUnit ? ` ${line.sourceUnit}` : ''}</td><td className="px-4 py-3">{line.currencyCode} {line.approvedUnitPrice!.toFixed(2)}</td><td className="px-4 py-3">Active</td><td className="px-4 py-3">{pe.expirationDate?.toISOString().slice(0, 10) ?? 'No expiration'}</td></tr>;
    })}</tbody></table>{!rows.length && <p className="p-8 text-center text-sm text-slate-500">No active, unexpired Price Exception tiers match these filters.</p>}</div>
    <div className="mt-4 flex justify-between text-sm text-slate-600"><span>{count} pricing tiers · Page {page} of {pages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={priceExceptionLookupHref(filters, page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={priceExceptionLookupHref(filters, page + 1)}>Next</Link>}</div></div>
  </Content>;
}
