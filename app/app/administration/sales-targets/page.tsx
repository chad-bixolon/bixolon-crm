import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { formatCurrency } from '@/lib/display-format';
import { quarters } from '@/lib/forecast';
import { archiveTargetAction, saveTargetAction } from './actions';
export const dynamic = 'force-dynamic';
type Filters = { userId?: string; year?: string; quarter?: string; currencyCode?: string; status?: string; error?: string; edit?: string };
export default async function SalesTargetsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await requirePermission('users.manage');
  if (actor.role !== 'ADMIN') return <Content><PageHeader title="Sales Targets" eyebrow="Administration"/><p>Access denied.</p></Content>;
  const f = await searchParams;
  const [users, currencies, targets] = await Promise.all([
    prisma.user.findMany({ where: { active: true, archivedAt: null, role: { in: ['SALES', 'SALES_MANAGER'] } }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
    prisma.salesTarget.findMany({ where: { ...(Number(f.userId) > 0 ? { userId: Number(f.userId) } : {}), ...(Number(f.year) >= 2000 ? { year: Number(f.year) } : {}), ...(quarters.includes(f.quarter as never) ? { quarter: f.quarter as 'Q1'|'Q2'|'Q3'|'Q4' } : {}), ...(f.currencyCode && /^[A-Z]{3}$/.test(f.currencyCode) ? { currencyCode: f.currencyCode } : {}), ...(f.status === 'archived' ? { archivedAt: { not: null } } : f.status === 'all' ? {} : { archivedAt: null }) }, include: { user: true }, orderBy: [{ year: 'desc' }, { quarter: 'desc' }, { user: { lastName: 'asc' } }, { currencyCode: 'asc' }] }),
  ]);
  const edit = targets.find(row => row.id === Number(f.edit) && !row.archivedAt);
  const year = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date());
  return <Content><PageHeader eyebrow="Administration" title="Sales Targets" description="One active target per rep, calendar quarter, and currency." action={<Link href="/administration" className="btn-secondary">Administration</Link>}/>
    {f.error && <p role="alert" className="mb-4 rounded bg-red-50 p-3 text-sm text-red-800">{f.error}</p>}
    <section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">{edit ? 'Edit target' : 'Add target'}</h2><form action={saveTargetAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{edit && <input type="hidden" name="id" value={edit.id}/>}
      <label className="label">Sales Rep<select className="field" name="userId" required defaultValue={edit?.userId ?? ''}><option value="">Choose rep</option>{users.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select></label>
      <label className="label">Year<input className="field" name="year" type="number" min="2000" max="2100" required defaultValue={edit?.year ?? year}/></label>
      <label className="label">Quarter<select className="field" name="quarter" defaultValue={edit?.quarter ?? 'Q1'}>{quarters.map(q => <option key={q}>{q}</option>)}</select></label>
      <label className="label">Currency<select className="field" name="currencyCode" defaultValue={edit?.currencyCode ?? 'USD'}>{currencies.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select></label>
      <label className="label">Target Amount<input className="field" name="targetAmount" type="number" min="0" step="0.01" required defaultValue={edit?.targetAmount.toFixed(2) ?? ''}/></label>
      <label className="label sm:col-span-2 lg:col-span-3">Notes<textarea className="field" name="notes" maxLength={2000} defaultValue={edit?.notes ?? ''}/></label>
      <div className="flex gap-2"><button className="btn-primary">{edit ? 'Save target' : 'Create target'}</button>{edit && <Link href="/administration/sales-targets" className="btn-secondary">Cancel</Link>}</div>
    </form></section>
    <form method="get" className="panel mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"><label className="label">Sales Rep<select className="field" name="userId" defaultValue={f.userId ?? ''}><option value="">All</option>{users.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select></label><label className="label">Year<input className="field" name="year" type="number" min="2000" max="2100" defaultValue={f.year ?? ''}/></label><label className="label">Quarter<select className="field" name="quarter" defaultValue={f.quarter ?? ''}><option value="">All</option>{quarters.map(q => <option key={q}>{q}</option>)}</select></label><label className="label">Currency<select className="field" name="currencyCode" defaultValue={f.currencyCode ?? ''}><option value="">All</option>{currencies.map(c => <option key={c.code}>{c.code}</option>)}</select></label><label className="label">Status<select className="field" name="status" defaultValue={f.status ?? 'active'}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label><div><button className="btn-secondary">Filter</button></div></form>
    <section className="panel overflow-x-auto"><table className="w-full min-w-[650px] text-sm"><thead className="border-b bg-slate-50"><tr>{['Sales Rep','Year','Quarter','Currency','Target','Status',''].map(label => <th className="p-3 text-left" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{targets.map(row => <tr key={row.id}><td className="p-3">{row.user.firstName} {row.user.lastName}</td><td className="p-3">{row.year}</td><td className="p-3">{row.quarter}</td><td className="p-3">{row.currencyCode}</td><td className="p-3 tabular-nums">{formatCurrency(row.targetAmount, row.currencyCode)}</td><td className="p-3">{row.archivedAt ? 'Archived' : 'Active'}</td><td className="p-3">{!row.archivedAt && <div className="flex gap-3"><Link className="text-orange-800 underline" href={`/administration/sales-targets?edit=${row.id}`}>Edit</Link><form action={archiveTargetAction}><input type="hidden" name="id" value={row.id}/><button className="text-orange-800 underline">Archive</button></form></div>}</td></tr>)}</tbody></table>{!targets.length && <p className="p-5 text-sm text-slate-500">No targets match.</p>}</section>
  </Content>;
}
