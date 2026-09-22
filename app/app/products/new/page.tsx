import { Content, PageHeader } from "@/components/shell";
import { ProductForm } from "@/components/product-form";
import { prisma } from "@/lib/prisma";
import { productCategoryChoices } from "@/lib/products";
export default async function NewProductPage() { const categories = await productCategoryChoices(prisma); return <Content><PageHeader eyebrow="Products" title="New product"/><ProductForm categories={categories}/></Content>; }
