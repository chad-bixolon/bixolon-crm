import { Content, PageHeader } from "@/components/shell";
import { ProductForm } from "@/components/product-form";
import { prisma } from "@/lib/prisma";
import { productCategoryChoices } from "@/lib/products";
import { requirePermission } from "@/lib/current-user";
export default async function NewProductPage() { await requirePermission('products.write'); const categories = await productCategoryChoices(prisma); return <Content><PageHeader eyebrow="Products" title="New product"/><ProductForm categories={categories}/></Content>; }
