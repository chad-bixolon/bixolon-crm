import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { ProductForm } from "@/components/product-form";
import { ArchiveCrmControl, CrmStateControl } from "@/components/crm-state-control";
import { prisma } from "@/lib/prisma";
import { serializeProductPricing } from "@/lib/product-serialization";
import { formatCurrency } from "@/lib/display-format";
export const dynamic = "force-dynamic";
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound(); const product = await prisma.product.findUnique({ where: { id }, include: { skus: { include: { prices: true }, orderBy: { partNumber: 'asc' } } } }); if (!product) notFound();
  const state = product.archivedAt ? "archived" : product.active ? "active" : "inactive";
  const mixedCurrencies = new Set(product.skus.flatMap(sku => sku.prices.map(price => price.currencyCode))).size > 1;
  return <Content><PageHeader eyebrow="Products" title={product.name} description={`SKU ${product.sku}`}/><div className="mb-5 flex gap-2"><CrmStateControl kind="product" id={id} state={state}/>{!product.archivedAt && <ArchiveCrmControl kind="product" id={id}/>}</div>{product.archivedAt ? <div className="panel p-6">Reactivate this product before editing it.</div> : <ProductForm id={id} initial={serializeProductPricing(product)}/>}<section className="panel mt-5 p-6"><h2 className="text-lg font-semibold">Part numbers & catalog prices</h2><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Part number</th><th className="p-2">Description</th><th className="p-2">Status</th><th className="p-2">Price tiers</th></tr></thead><tbody>{product.skus.map(sku=><tr className="border-b" key={sku.id}><td className="p-2">{sku.partNumber}</td><td className="p-2">{sku.description || '—'}</td><td className="p-2">{sku.active ? 'Active' : 'Inactive'}</td><td className="p-2">{sku.prices.map(price=>`${price.tier} ${formatCurrency(price.amount, price.currencyCode, mixedCurrencies)} / ${sku.priceUnit.toLowerCase()}`).join(', ') || '—'}</td></tr>)}</tbody></table>{!product.skus.length&&<p className="p-3 text-sm text-slate-600">No part numbers.</p>}</div></section></Content>;
}
