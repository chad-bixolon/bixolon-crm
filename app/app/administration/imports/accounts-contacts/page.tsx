import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { template } from '@/lib/import-csv';
import { ImportWorkflow } from '../workflow';

export default async function AccountsContactsImportPage() {
  await requirePermission('users.manage');
  return <Content>
    <PageHeader eyebrow="Administration → Imports" title="Accounts & Contacts" description="Upload a CSV or XLSX file containing Accounts and Contacts. Review the proposed changes before confirming the import." action={<Link className="btn-secondary" href="/administration/imports">All imports</Link>}/>
    <ImportWorkflow template={template}/>
  </Content>;
}
