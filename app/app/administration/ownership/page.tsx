import { FilterDisclosure } from '@/components/filter-disclosure';
import { HelpLink } from '@/components/help-link';
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
    prisma.user.findMany({ where: eligibleUserWhere(type === 'Support Case' ? 'support-case' : 'support-task'), select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
  ]);
  const href = (entity: string, p = 1) => `/administration/ownership?${new URLSearchParams({ entity, ...(owner ? { owner: String(owner) } : {}), page: String(p) })}`;
  const bulk = type === 'Task' || type === 'Support Case';
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Ownership & Reassignment" description="Review records assigned to inactive or unavailable users and reassign them when needed." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><div className="mb-3"><HelpLink topic="ownership-reassignment">Help with Ownership &amp; Reassignment</HelpLink></div>
    <p className="mb-4 text-sm text-slate-600">Unassigned records are reviewed in Data Quality. Contacts use their Account’s owner.</p>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">{ownershipTypes.map(entity => <Link className="panel p-4" aria-current={entity === type ? 'page' : undefined} key={entity} href={href(entity)}><strong>{entity}</strong><p className="mt-1 text-xl tabular-nums">{counts[entity]}</p></Link>)}</div>
    <form key={`${type}-${owner ?? ""}`} className="panel filter-panel responsive-filter-form mb-4 flex flex-wrap items-end gap-3 p-4" method="get">
      <FilterDisclosure initialCount={owner ? 1 : 0} clearHref={`/administration/ownership?entity=${encodeURIComponent(type)}`} defaults={{ entity: type }}/>
      <div className="min-w-0 flex-[1_1_12rem]"><label className="label" htmlFor="entity">Record type</label><select className="field" name="entity" id="entity" defaultValue={type}>{ownershipTypes.map(entity => <option key={entity}>{entity}</option>)}</select></div>
      <div className="min-w-0 flex-[1.5_1_16rem]"><label className="label" htmlFor="owner">Current owner or assignee</label><select className="field" name="owner" id="owner" defaultValue={owner ?? ''}><option value="">All users</option>{users.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select></div>
      <div className="flex flex-none flex-wrap items-center gap-2">
        <button className="btn-filter-primary whitespace-nowrap">Apply filters</button>
        <Link className="btn-filter-secondary whitespace-nowrap" href={`/administration/ownership?entity=${encodeURIComponent(type)}`}>Clear filters</Link>
      </div>
      <div className="w-full"><Link className="text-sm text-orange-800 underline" href="/administration/data-quality">Data Quality</Link></div>
    </form>
    <BulkSelection key={`${type}-${owner}-${page}`} kind={type === 'Support Case' ? 'cases' : 'tasks'} records={rows.map(({ id, updatedAt }) => ({ id, updatedAt }))} assignees={assignees.map(user => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }))} enabled={bulk} allowedActions={['assign']}>
      <div className="panel overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="border-b bg-slate-50"><tr>{bulk && <th className="p-3"><BulkPageCheckbox/></th>}<th className="p-3">Record</th><th className="p-3">Current owner or assignee</th><th className="p-3">Review</th></tr></thead><tbody className="divide-y">{rows.map(row => <tr key={row.id}>{bulk && <td className="p-3"><BulkCheckbox id={row.id} label={row.name}/></td>}<td className="p-3"><Link className="font-semibold text-orange-800 underline" href={row.href}>{row.name}</Link></td><td className="p-3">{row.owner}</td><td className="p-3"><Link className="text-orange-800 underline" href={row.edit}>{type === 'Contact' ? 'Review Account owner' : 'Review / reassign'}</Link></td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-sm text-slate-600">{owner ? "No records need reassignment for these filters." : "No records need reassignment for this record type."}</p>}</div>
    </BulkSelection>
    <nav aria-label="Ownership pages" className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>{counts[type]} records · Page {page} of {pages}</span>{page > 1 && <Link className="btn-secondary" href={href(type, page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={href(type, page + 1)}>Next</Link>}</nav>
    <p className="mt-4 text-sm text-slate-600">Tasks and Support Cases can be reassigned here. Other records can be updated from their normal edit pages.</p>
  </Content>;
}
