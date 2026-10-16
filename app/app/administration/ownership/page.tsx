import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { BulkSelection, BulkCheckbox, BulkPageCheckbox } from '@/components/bulk-selection';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { eligibleUserWhere } from '@/lib/assignment-eligibility';
import { adminPage, adminPageSize, ownershipCounts, ownershipRows, ownershipType, ownershipTypes } from '@/lib/admin-ownership';
export const dynamic = 'force-dynamic';
type Filters = { entity?: string; owner?: string; page?: string };
export default async function OwnershipPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await requirePermission('users.manage'), f = await searchParams;
  const type = ownershipType(f.entity), owner = /^\d+$/.test(f.owner ?? '') ? Number(f.owner) || undefined : undefined;
  const counts = await ownershipCounts(prisma, actor, owner);
  const pages = Math.max(1, Math.ceil(counts[type] / adminPageSize)), page = Math.min(adminPage(f.page), pages);
  const [rows, users, assignees] = await Promise.all([
    ownershipRows(prisma, actor, type, owner, page),
    prisma.user.findMany({ orderBy: [{ lastName: 'asc' }, { id: 'asc' }], select: { id: true, firstName: true, lastName: true } }),
    prisma.user.findMany({ where: eligibleUserWhere(type === 'Support Case' ? 'support-cases.write' : 'tasks.write'), select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
  ]);
  const href = (entity: string, p = 1) => `/administration/ownership?${new URLSearchParams({ entity, ...(owner ? { owner: String(owner) } : {}), page: String(p) })}`;
  const bulk = type === 'Task' || type === 'Support Case';
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Ownership & Reassignment" description="Review current records assigned to inactive, archived, or ineligible users." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/>
    <p className="mb-4 text-sm text-slate-600">Ownership and assignment are optional in the current forms. Blank owners are not errors here. Contacts inherit their Account’s owner. Use Data Quality to review unowned Accounts and Opportunities.</p>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">{ownershipTypes.map(entity => <Link className="panel p-4" aria-current={entity === type ? 'page' : undefined} key={entity} href={href(entity)}><strong>{entity}</strong><p className="mt-1 text-xl tabular-nums">{counts[entity]}</p></Link>)}</div>
    <form className="panel mb-4 flex flex-wrap items-end gap-3 p-4" method="get"><div className="min-w-0 w-full sm:w-auto"><label className="label" htmlFor="entity">Entity type</label><select className="field" name="entity" id="entity" defaultValue={type}>{ownershipTypes.map(entity => <option key={entity}>{entity}</option>)}</select></div><div className="min-w-0 w-full sm:w-auto sm:max-w-sm"><label className="label" htmlFor="owner">Current owner / user</label><select className="field" name="owner" id="owner" defaultValue={owner ?? ''}><option value="">All users</option>{users.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select></div><button className="btn-primary">Apply filters</button><Link className="text-sm text-orange-800 underline" href="/administration/data-quality">Data Quality</Link></form>
    <BulkSelection key={`${type}-${owner}-${page}`} kind={type === 'Support Case' ? 'cases' : 'tasks'} records={rows.map(({ id, updatedAt }) => ({ id, updatedAt }))} assignees={assignees.map(user => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }))} enabled={bulk} allowedActions={['assign']}>
      <div className="panel overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="border-b bg-slate-50"><tr>{bulk && <th className="p-3"><BulkPageCheckbox/></th>}<th className="p-3">Record</th><th className="p-3">Current owner / user</th><th className="p-3">Review</th></tr></thead><tbody className="divide-y">{rows.map(row => <tr key={row.id}>{bulk && <td className="p-3"><BulkCheckbox id={row.id} label={row.name}/></td>}<td className="p-3"><Link className="font-semibold text-orange-800 underline" href={row.href}>{row.name}</Link></td><td className="p-3">{row.owner}</td><td className="p-3"><Link className="text-orange-800 underline" href={row.edit}>{type === 'Contact' ? 'Review Account owner' : 'Review / reassign'}</Link></td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-sm text-slate-600">No ownership issues match these filters.</p>}</div>
    </BulkSelection>
    <nav aria-label="Ownership pages" className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>{counts[type]} records · Page {page} of {pages}</span>{page > 1 && <Link className="btn-secondary" href={href(type, page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={href(type, page + 1)}>Next</Link>}</nav>
    <p className="mt-4 text-sm text-slate-600">Task and Support Case updates require confirmation and pass existing record validation. Other records use their individual edit forms. Closed work and records with inactive parent relationships are excluded.</p>
  </Content>;
}
