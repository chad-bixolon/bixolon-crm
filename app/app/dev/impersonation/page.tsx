import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { getRealAuthenticatedUser } from '@/lib/current-user';
import { impersonationAdminAllowed } from '@/lib/dev-impersonation';
import { prisma } from '@/lib/prisma';
import { roleLabels } from '@/lib/role-labels';
import { startImpersonation } from './actions';

export default async function DevelopmentImpersonationPage() {
  const real = await getRealAuthenticatedUser();
  if (!impersonationAdminAllowed(real)) notFound();
  const users = await prisma.user.findMany({ where: { active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true, email: true, role: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  return <Content><PageHeader eyebrow="Local development" title="Test as user" description="Choose an active CRM user to test their permissions and record scope." />
    <div className="panel max-w-3xl overflow-hidden"><ul className="divide-y divide-slate-200">{users.map(user => <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="font-semibold">{user.firstName} {user.lastName} <span className="ml-2 text-sm font-normal text-slate-600">{roleLabels[user.role]}</span></div><div className="text-sm text-slate-600">{user.email}</div></div><form action={startImpersonation}><input type="hidden" name="userId" value={user.id}/><button className="btn-secondary" type="submit">Test as user</button></form></li>)}</ul></div>
    <p className="mt-4 text-sm text-slate-600">Writes during testing use the selected user as the actor. Return to Admin when finished.</p></Content>;
}
