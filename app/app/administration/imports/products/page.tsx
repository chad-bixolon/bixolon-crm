import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { productImportTemplate } from '@/lib/product-import';
import { ProductImportWorkflow } from './workflow';
export default async function ProductsImportPage() {
  await requirePermission('users.manage');
  return <Content><PageHeader eyebrow="Administration → Imports" title="Products & Pricing" description="Upload a BIXOLON pricing workbook or formatted CSV/XLSX file. For ODM rows, resolve customer Accounts and review SKU classification before confirming the import." action={<Link className="btn-secondary" href="/administration/imports">All imports</Link>}/><ProductImportWorkflow template={productImportTemplate}/></Content>;
}
