import { NAV_CATEGORIES } from '../../../../lib/navigation-categories';
import { notFound, redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { ProjectForm } from '@/components/project-form';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { canEditProject } from '@/lib/projects';
import { eligibleUserWhere } from '@/lib/assignment-eligibility';
export const dynamic = 'force-dynamic';
export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser(), id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [project, owners] = await Promise.all([
    prisma.project.findUnique({ where: { id }, include: { owner: { select: { firstName: true, lastName: true } }, primaryAccount: { select: { ownerId: true } }, participants: { include: { roles: true } } } }),
    prisma.user.findMany({ where: eligibleUserWhere('projects.write'), select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
  ]);
  if (!project) notFound();
  if (!canEditProject(actor, project)) redirect('/access-denied');
  const linkedAccountIds = [project.primaryAccountId, ...project.participants.map(participant => participant.accountId)]
    .filter((accountId): accountId is number => accountId !== null);
  const accounts = linkedAccountIds.length ? await prisma.account.findMany({ where: { id: { in: linkedAccountIds } }, select: { id: true, name: true } }) : [];
  const initial = { ...project, participants: project.participants.map(p => ({ accountId: p.accountId, roles: p.roles.map(r => r.role) })) };
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.programs} title={`Edit ${project.name}`}/>{project.archivedAt ? <div className="panel p-6">Reactivate this Project before editing it.</div> : <ProjectForm id={id} initial={initial} accounts={accounts} owners={owners} currentOwner={project.owner}/>}</Content>;
}
