import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { ProductForm } from "@/components/product-form";
import { ArchiveCrmControl, CrmStateControl } from "@/components/crm-state-control";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound(); const product = await prisma.product.findUnique({ where: { id } }); if (!product) notFound();
  const state = product.archivedAt ? "archived" : product.active ? "active" : "inactive";
  return <Content><PageHeader eyebrow="Products" title={product.name} description={`SKU ${product.sku}`}/><div className="mb-5 flex gap-2"><CrmStateControl kind="product" id={id} state={state}/>{!product.archivedAt && <ArchiveCrmControl kind="product" id={id}/>}</div>{product.archivedAt ? <div className="panel p-6">Reactivate this product before editing it.</div> : <ProductForm id={id} initial={product}/>}</Content>;
}
