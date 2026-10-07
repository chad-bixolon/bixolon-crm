import { NAV_CATEGORIES } from '../../lib/navigation-categories';
import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { odmSubtypeLabels } from "@/lib/product-labels";
import { catalogSourceLabels, listProducts, productCategoryChoices, productHref, type ProductFilters } from "@/lib/products";
import { CrmStateControl } from "@/components/crm-state-control";
import { prisma } from "@/lib/prisma";
import { requirePermission } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { ProductTableRow } from "./product-table-row";
import { priceExceptionLookupHref } from '@/lib/price-exception-lookup';
import styles from "./products-page.module.css";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<ProductFilters> }) {
  const filters = await searchParams;
  const actor = await requirePermission('products.read');
  const canManageProducts = can(actor, 'products.write');
  const [{ products, count, page, pages, priceExceptionsByProduct }, categories] = await Promise.all([listProducts(prisma, filters, actor), productCategoryChoices(prisma)]);
  const linkFor = (target: number) => productHref(filters, target);

  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.catalogPricing} title="Products" description="Products available for opportunity estimates." action={canManageProducts ? <Link className="btn-primary" href="/products/new">New product</Link> : undefined}/>
    <form method="get" className="panel filter-panel filter-grid filter-row mb-4" aria-label="Filter products">
      <label className="label">Search<input className="field filter-control" name="q" id="q" placeholder="SKU or name" defaultValue={filters.q ?? ""}/></label>
      <label className="label">Status<select className="field filter-control" name="active" id="active" defaultValue={filters.active ?? ""}><option value="">Current</option><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
      <label className="label">Product Category<select className="field filter-control" name="category" id="category" defaultValue={filters.category ?? ""}><option value="">All</option>{categories.map(category=><option key={category.id} value={category.code}>{category.name}{category.active ? "" : " (inactive)"}</option>)}</select></label>
      <label className="label">Catalog Source<select className="field filter-control" name="catalogSource" id="catalogSource" defaultValue={filters.catalogSource ?? ""}><option value="">All</option>{Object.entries(catalogSourceLabels).filter(([value])=>value!=='SPECIAL_SKU_LIST').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">Price Exception<select className="field filter-control" name="priceException" id="priceException" defaultValue={filters.priceException ?? ""}><option value="">Any</option><option value="has">Has active PE</option><option value="none">No active PE</option></select></label>
      <div className="filter-actions"><button className="btn-filter-primary">Apply</button><Link className="btn-filter-secondary" href="/products">Clear</Link></div>
    </form>
    <p className="mb-3 text-sm text-slate-600">Need a customer and SKU match? <Link className="text-orange-800 underline" href="/price-exceptions/lookup">Find a valid Price Exception</Link>.</p>
    <div className="panel overflow-x-auto">
      <table className={`w-full min-w-[640px] text-left ${styles.catalog}`}>
        <thead><tr><th scope="col">SKU</th><th scope="col">Product / Model</th><th scope="col">Price Exception</th><th scope="col">Status</th>{canManageProducts && <th scope="col">Action</th>}</tr></thead>
        <tbody className="divide-y divide-slate-100">{products.map((p) => {
          const state = p.archivedAt ? "archived" : p.active ? "active" : "inactive";
          const peIds = priceExceptionsByProduct.get(p.id) ?? [];
          return <ProductTableRow key={p.id} id={p.id} name={p.name} canManage={canManageProducts}>
            <td className={styles.sku}>{p.sku}{p.skus.filter(sku => sku.catalogSource === 'ODM').slice(0, 2).map(sku => <span key={sku.id} className="ml-2 inline-block rounded bg-orange-50 px-1.5 py-0.5 text-xs font-semibold text-orange-800">{sku.partNumber} · ODM{sku.odmSubtype ? ` · ${odmSubtypeLabels[sku.odmSubtype]}` : ''}{sku.odmCustomers.length ? ` · ${sku.odmCustomers.map(link => link.account.name).join(", ")}` : ''}</span>)}</td>
            <td><Link className={styles.model} href={canManageProducts ? `/products/${p.id}/edit` : `/products/${p.id}`}>{p.name}</Link></td>
            <td>{peIds.length ? <Link className="font-semibold text-orange-800 underline" href={priceExceptionLookupHref({ productId: String(p.id), catalogSource: filters.catalogSource })}>{peIds.length === 1 ? 'Active PE available' : `${peIds.length} active PEs`}</Link> : <span className="text-slate-400">—</span>}</td>
            <td><span className={`${styles.badge} ${styles[state]}`}>{state[0].toUpperCase() + state.slice(1)}</span></td>
            {canManageProducts && <td><CrmStateControl kind="product" id={p.id} state={state}/></td>}
          </ProductTableRow>;
        })}</tbody>
      </table>
      {!products.length && <p className="p-8 text-center text-sm text-slate-500">No products match these filters.</p>}
    </div>
    <div className="mt-4 flex justify-between text-sm text-slate-600"><span>{count} products · Page {page} of {pages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={linkFor(page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={linkFor(page + 1)}>Next</Link>}</div></div>
  </Content>;
}
