import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { template } from '@/lib/import-csv';
import { ImportWorkflow } from './workflow';
export default async function ImportsPage() {
  await requirePermission('users.manage');
  return <Content><PageHeader eyebrow="Administration → Imports" title="Accounts & Contacts" description="Upload a CSV or XLSX file, review every proposed change, then confirm the import."/><ImportWorkflow template={template}/></Content>;
}
