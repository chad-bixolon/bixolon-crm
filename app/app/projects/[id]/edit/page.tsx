import { notFound, redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { ProjectForm } from '@/components/project-form';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { canEditProject } from '@/lib/projects';
export const dynamic = 'force-dynamic';
export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser(), id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [project, accounts, owners] = await Promise.all([
    prisma.project.findUnique({ where: { id }, include: { primaryAccount: { select: { ownerId: true } }, participants: { include: { roles: true } } } }),
    prisma.account.findMany({ where: { status: 'ACTIVE', archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
  ]);
  if (!project) notFound();
  if (!canEditProject(actor, project)) redirect('/access-denied');
  const initial = { ...project, participants: project.participants.map(p => ({ accountId: p.accountId, roles: p.roles.map(r => r.role) })) };
  return <Content><PageHeader eyebrow="Projects" title={`Edit ${project.name}`}/>{project.archivedAt ? <div className="panel p-6">Reactivate this Project before editing it.</div> : <ProjectForm id={id} initial={initial} accounts={accounts} owners={owners}/>}</Content>;
}
