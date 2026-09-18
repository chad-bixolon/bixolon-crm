import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { productImportTemplate } from '@/lib/product-import';
import { ProductImportWorkflow } from './workflow';
export default async function ProductsImportPage() {
  await requirePermission('users.manage');
  return <Content><PageHeader eyebrow="Administration → Imports" title="Products & Pricing" description="Upload the current BIXOLON pricing workbook or a formatted CSV/XLSX file. Select a worksheet, review Product, SKU, and pricing changes, then confirm the import." action={<Link className="btn-secondary" href="/administration/imports">All imports</Link>}/><ProductImportWorkflow template={productImportTemplate}/></Content>;
}
