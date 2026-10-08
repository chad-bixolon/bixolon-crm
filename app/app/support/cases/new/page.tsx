import { Content, PageHeader } from '@/components/shell';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { SupportCaseForm } from '@/components/support-case-form';
import { requirePermission } from '@/lib/current-user';
import { supportFormOptions } from '@/lib/support-case-ui';
export const dynamic = 'force-dynamic';
export default async function NewSupportCasePage() { const actor = await requirePermission('support-cases.write'); const options = await supportFormOptions(actor); return <Content><PageHeader eyebrow={NAV_CATEGORIES.support} title="New Support Case" description="Record a customer issue."/><SupportCaseForm {...options}/></Content>; }
