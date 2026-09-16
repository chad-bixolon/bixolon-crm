import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { listProducts, type ProductFilters } from "@/lib/products";
import { CrmStateControl } from "@/components/crm-state-control";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function ProductsPage({ searchParams }: { searchParams: Promise<ProductFilters> }) {
  const filters = await searchParams; const { products, count, page, pages } = await listProducts(prisma, filters);
  const linkFor = (target: number) => { const p = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value && key !== "page") p.set(key, value); }); p.set("page", String(target)); return `/products?${p}`; };
  return <Content><PageHeader eyebrow="CRM records" title="Products" description="Products available for opportunity estimates." action={<Link className="btn-primary" href="/products/new">New product</Link>}/>
    <form method="get" className="panel mb-5 flex flex-wrap items-end gap-3 p-4" aria-label="Filter products"><div><label className="label" htmlFor="q">Search</label><input className="field" name="q" id="q" placeholder="SKU or name" defaultValue={filters.q ?? ""}/></div><div><label className="label" htmlFor="active">Status</label><select className="field" name="active" id="active" defaultValue={filters.active ?? ""}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></div><button className="btn-primary">Apply</button><Link className="btn-secondary" href="/products">Clear</Link></form>
    <div className="panel overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-4">SKU</th><th className="px-5 py-4">Name</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Action</th></tr></thead><tbody className="divide-y">{products.map((p) => { const state = p.archivedAt ? "archived" : p.active ? "active" : "inactive"; return <tr key={p.id}><td className="px-5 py-4 font-medium">{p.sku}</td><td className="px-5 py-4"><Link className="text-orange-800" href={`/products/${p.id}/edit`}>{p.name}</Link></td><td className="px-5 py-4">{state}</td><td className="px-5 py-4"><CrmStateControl kind="product" id={p.id} state={state}/></td></tr>; })}</tbody></table>{!products.length && <p className="p-8 text-center text-sm text-slate-500">No products match these filters.</p>}</div>
    <div className="mt-4 flex justify-between text-sm text-slate-600"><span>{count} products · Page {page} of {pages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={linkFor(page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={linkFor(page + 1)}>Next</Link>}</div></div>
  </Content>;
}
