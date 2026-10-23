import { userTimeZoneOptions } from "@/lib/user-time-zone";
import { NAV_CATEGORIES } from '../../../../../lib/navigation-categories';
import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { UserForm } from "@/components/user-form";
import { prisma } from "@/lib/prisma";
import { roleLabels } from "@/lib/role-labels";
import { requirePermission } from "@/lib/current-user";
import { GoogleIdentityReset } from "@/components/google-identity-reset";
import { userHistoryDescription } from "@/lib/user-history-display";
export const dynamic = "force-dynamic";
export default async function EditUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const actor = await requirePermission("users.manage");
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const user = await prisma.user.findUnique({ where: { id } }); if (!user) notFound();
  const identity = await prisma.externalIdentity.findFirst({ where: { userId: id, provider: 'GOOGLE' }, select: { id: true } });
  const history = await prisma.adminMaintenanceEvent.findMany({ where: { entityType: 'User', recordIds: { has: id } }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 100 });
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(history.map(event => event.actorId))] } }, select: { id: true, firstName: true, lastName: true } });
  const finalAdmin = user.role === 'ADMIN' && user.active && !user.archivedAt && await prisma.user.count({ where: { role: 'ADMIN', active: true, archivedAt: null } }) === 1;
  const canEdit = actor.role === 'ADMIN' || (user.role !== 'ADMIN' && !user.delegatedUserAdministrationEnabled);
  const created = (await searchParams).saved === "created";
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title={`${user.archivedAt ? 'Archived' : 'Edit'} ${user.firstName} ${user.lastName}`}/>{user.archivedAt ? <div className="panel space-y-3 p-6"><span className="inline-block rounded bg-slate-100 px-3 py-1 text-sm font-semibold">Archived</span><p className="text-sm">{user.email} · {roleLabels[user.role]}</p><p className="text-sm">This user is archived and cannot be edited.</p></div> : <>{canEdit ? <UserForm timeZoneOptions={userTimeZoneOptions(user.timeZone)} id={id} initial={user} created={created} trueAdmin={actor.role === "ADMIN"} finalAdmin={finalAdmin}/> : <p>Only an Administrator may manage administrative access for this user.</p>}</>}<section className="panel mt-5 p-6"><h2 className="font-semibold">Google sign-in</h2><p>{identity ? 'Linked' : 'Not yet linked'}</p>{!identity && <p className="mt-2 text-sm">The link is created automatically after the user&apos;s first successful Google sign-in.</p>}<p className="mt-2 text-sm">Resetting the CRM sign-in link does not change or reset the user&apos;s Google account. Changing the CRM email does not transfer an existing link.</p>{identity && canEdit && !user.archivedAt && <GoogleIdentityReset userId={id} identityId={identity.id} email={user.email}/>}</section><section className="panel mt-5 p-6"><h2 className="font-semibold">User Administration history</h2><ul className="space-y-3">{history.map(event => { const by = actors.find(person => person.id === event.actorId); return <li key={event.id} className="break-words text-sm">{event.occurredAt.toISOString()} · {by ? `${by.firstName} ${by.lastName}` : `User #${event.actorId}`} · {userHistoryDescription(event)}</li>; })}</ul>{!history.length && <p>No recorded changes yet.</p>}</section></Content>;
}
