import Link from 'next/link';
import { ProjectStatus, type Prisma } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { projectReadWhere, projectRoleLabels, projectStatusLabels } from '@/lib/projects';
import { positiveId } from '@/lib/crm-validation';
export const dynamic = 'force-dynamic';
type Filters = { q?: string; status?: string; ownerId?: string; accountId?: string; archived?: string };
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await currentUser(), filters = await searchParams;
  const ownerId = positiveId(filters.ownerId ?? ''), accountId = positiveId(filters.accountId ?? '');
  const status = Object.values(ProjectStatus).includes(filters.status as ProjectStatus) ? filters.status as ProjectStatus : null;
  const where: Prisma.ProjectWhereInput = { AND: [projectReadWhere(actor),
    { ...(filters.archived === 'yes' ? { archivedAt: { not: null } } : filters.archived === 'all' ? {} : { archivedAt: null }),
      ...(filters.q?.trim() ? { name: { contains: filters.q.trim().slice(0, 100), mode: 'insensitive' } } : {}),
      ...(status ? { status } : {}), ...(ownerId ? { ownerId } : {}),
      ...(accountId ? { OR: [{ primaryAccountId: accountId }, { participants: { some: { accountId } } }] } : {}) } ] };
  const [projects, accounts, owners] = await Promise.all([
    prisma.project.findMany({ where, include: { primaryAccount: true, owner: true, _count: { select: { participants: true, opportunities: { where: { opportunity: { archivedAt: null } } } } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] }),
    prisma.account.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
  ]);
  return <Content><PageHeader eyebrow="CRM records" title="Projects" description="Programs and initiatives with optional Account relationships." action={can(actor, 'projects.write') ? <Link className="btn-primary" href="/projects/new">New Project</Link> : undefined}/>
    <form method="get" className="panel filter-panel filter-grid filter-grid-five mb-5" aria-label="Filter projects">
      <label className="label">Search<input className="field filter-control" name="q" defaultValue={filters.q ?? ''} placeholder="Project name"/></label>
      <label className="label">Status<select className="field filter-control" name="status" defaultValue={filters.status ?? ''}><option value="">All statuses</option>{Object.entries(projectStatusLabels).map(([code,label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label className="label">Account<select className="field filter-control" name="accountId" defaultValue={filters.accountId ?? ''}><option value="">All Accounts</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="label">Owner<select className="field filter-control" name="ownerId" defaultValue={filters.ownerId ?? ''}><option value="">All owners</option>{owners.map(o => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}</select></label>
      <label className="label">Visibility<select className="field filter-control" name="archived" defaultValue={filters.archived ?? ''}><option value="">Current</option><option value="yes">Archived</option><option value="all">All</option></select></label>
      <div className="filter-actions"><button className="btn-filter-primary">Apply</button><Link className="btn-filter-secondary" href="/projects">Clear</Link></div>
    </form>
    <div className="panel overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-4">Project</th><th className="p-4">Primary Account</th><th className="p-4">Role</th><th className="p-4">Owner</th><th className="p-4">Status</th><th className="p-4">Additional</th><th className="p-4">Opportunities</th></tr></thead><tbody className="divide-y">{projects.map(p => <tr key={p.id}><td className="p-4"><Link className="font-semibold text-orange-800" href={`/projects/${p.id}`}>{p.name}</Link>{p.archivedAt && <span className="ml-2 text-xs">Archived</span>}</td><td className="p-4">{p.primaryAccount ? <Link className="text-orange-800" href={`/accounts/${p.primaryAccountId}`}>{p.primaryAccount.name}</Link> : '—'}</td><td className="p-4">{p.primaryAccount ? projectRoleLabels[p.primaryAccountRole] : '—'}</td><td className="p-4">{p.owner ? `${p.owner.firstName} ${p.owner.lastName}` : 'Unassigned'}</td><td className="p-4">{projectStatusLabels[p.status]}</td><td className="p-4">{p._count.participants}</td><td className="p-4">{can(actor, 'sales.read') ? p._count.opportunities : '—'}</td></tr>)}</tbody></table>{!projects.length && <p className="p-8 text-center text-sm text-slate-500">No Projects match these filters.</p>}</div>
  </Content>;
}
