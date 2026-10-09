import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { ProjectForm } from '@/components/project-form';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/current-user';
import { positiveId } from '@/lib/crm-validation';
import { defaultEligibleUserId, eligibleUserWhere } from '@/lib/assignment-eligibility';
export const dynamic = 'force-dynamic';
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ primaryAccountId?: string }> }) {
  const actor = await requirePermission('projects.write');
  const [owners, params] = await Promise.all([
    prisma.user.findMany({ where: eligibleUserWhere('projects.write'), select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }), searchParams,
  ]);
  const candidate = positiveId(params.primaryAccountId ?? '');
  const accounts = candidate ? await prisma.account.findMany({ where: { id: candidate, status: 'ACTIVE', archivedAt: null }, select: { id: true, name: true } }) : [];
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.programs} title="New Project" description="Use Projects for broader initiatives, evaluations, implementations, or programs that may involve multiple Opportunities."/><ProjectForm accounts={accounts} owners={owners} defaultOwnerId={defaultEligibleUserId(owners, actor.id)} primaryAccountId={accounts.length ? candidate! : undefined}/></Content>;
}
