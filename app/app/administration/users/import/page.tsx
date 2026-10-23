import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { UserCsvImport } from '@/components/user-csv-import';
export default async function ImportUsersPage() {
  await requirePermission('users.import');
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Import users" description="Review CSV changes before approving CRM access."/><UserCsvImport/></Content>;
}
