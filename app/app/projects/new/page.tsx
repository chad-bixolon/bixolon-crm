import { Content, PageHeader } from '@/components/shell';
import { ProjectForm } from '@/components/project-form';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/current-user';
import { positiveId } from '@/lib/crm-validation';
export const dynamic = 'force-dynamic';
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ primaryAccountId?: string }> }) {
  await requirePermission('projects.write');
  const [accounts, owners, params] = await Promise.all([
    prisma.account.findMany({ where: { status: 'ACTIVE', archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }), searchParams,
  ]);
  const candidate = positiveId(params.primaryAccountId ?? '');
  return <Content><PageHeader eyebrow="Projects" title="New Project" description="Use Projects for broader initiatives, evaluations, implementations, or programs that may involve multiple Opportunities."/><ProjectForm accounts={accounts} owners={owners} primaryAccountId={accounts.some(a => a.id === candidate) ? candidate! : undefined}/></Content>;
}
