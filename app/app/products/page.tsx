import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { listProducts, type ProductFilters } from "@/lib/products";
import { CrmStateControl } from "@/components/crm-state-control";
import { prisma } from "@/lib/prisma";
import { ProductTableRow } from "./product-table-row";
import styles from "./products-page.module.css";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<ProductFilters> }) {
  const filters = await searchParams;
  const { products, count, page, pages } = await listProducts(prisma, filters);
  const linkFor = (target: number) => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value && key !== "page") p.set(key, value); });
    p.set("page", String(target));
    return `/products?${p}`;
  };

  return <Content>
    <PageHeader eyebrow="CRM records" title="Products" description="Products available for opportunity estimates." action={<Link className="btn-primary" href="/products/new">New product</Link>}/>
    <form method="get" className={`panel ${styles.toolbar}`} aria-label="Filter products">
      <div className={styles.filterField}><label className={styles.filterLabel} htmlFor="q">Search</label><input className={`field ${styles.control}`} name="q" id="q" placeholder="SKU or name" defaultValue={filters.q ?? ""}/></div>
      <div className={`${styles.filterField} ${styles.statusField}`}><label className={styles.filterLabel} htmlFor="active">Status</label><select className={`field ${styles.control}`} name="active" id="active" defaultValue={filters.active ?? ""}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></div>
      <button className={`btn-primary ${styles.action}`}>Apply</button>
      <Link className={`btn-secondary ${styles.action}`} href="/products">Clear</Link>
    </form>
    <div className="panel overflow-x-auto">
      <table className={`w-full min-w-[640px] text-left ${styles.catalog}`}>
        <thead><tr><th scope="col">SKU</th><th scope="col">Product / Model</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{products.map((p) => {
          const state = p.archivedAt ? "archived" : p.active ? "active" : "inactive";
          return <ProductTableRow key={p.id} id={p.id} name={p.name}>
            <td className={styles.sku}>{p.sku}</td>
            <td><Link className={styles.model} href={`/products/${p.id}/edit`}>{p.name}</Link></td>
            <td><span className={`${styles.badge} ${styles[state]}`}>{state[0].toUpperCase() + state.slice(1)}</span></td>
            <td><div className={styles.stateAction}><CrmStateControl kind="product" id={p.id} state={state}/></div></td>
          </ProductTableRow>;
        })}</tbody>
      </table>
      {!products.length && <p className="p-8 text-center text-sm text-slate-500">No products match these filters.</p>}
    </div>
    <div className="mt-4 flex justify-between text-sm text-slate-600"><span>{count} products · Page {page} of {pages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={linkFor(page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={linkFor(page + 1)}>Next</Link>}</div></div>
  </Content>;
}
