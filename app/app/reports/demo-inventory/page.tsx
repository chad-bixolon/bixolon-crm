import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { prisma } from '@/lib/prisma';
import { dateOnly, daysDeployed, demoSummary, matchesDemoReportRequest, matchesDemoReportUnit, opportunityResult, type DemoReportFilters } from '@/lib/demo-operations';
import { demoLabel } from '@/lib/demos';
import { demoStatusLabel } from '@/lib/demo-display';

export const dynamic = 'force-dynamic';
export default async function DemoInventoryReport({ searchParams }: { searchParams: Promise<DemoReportFilters> }) {
  const actor = await currentUser();
  if (!can(actor, 'sales.read') || !can(actor, 'accounts.read')) notFound();
  const f = await searchParams;
  const requests = await prisma.demoRequest.findMany({
    where: { ...(actor.role === 'SALES' ? { OR: [{ requestedById: actor.id }, { opportunity: { ownerId: actor.id } }] } : {}) },
    include: { account: { select: { id: true, name: true } }, requestedBy: { select: { firstName: true, lastName: true } }, project: { select: { id: true, name: true, status: true, archivedAt: true } }, opportunity: { select: { id: true, name: true, stage: { select: { name: true, isClosed: true, isWon: true } } } }, items: { include: { productSku: { select: { id: true, partNumber: true, product: { select: { id: true, name: true } } } }, units: { orderBy: { ordinal: 'asc' } } } } },
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
  });
  const summaries = requests.map(request => ({ request, summary: demoSummary(request) }));
  const choices = {
    accountId: requests.map(request => ({ id: request.accountId, label: request.account.name })),
    ownerId: requests.filter(request => request.requestedBy).map(request => ({ id: request.requestedById!, label: `${request.requestedBy!.firstName} ${request.requestedBy!.lastName}` })),
    productId: requests.flatMap(request => request.items.flatMap(item => item.productSku ? [{ id: item.productSku.product.id, label: item.productSku.product.name }] : [])),
    skuId: requests.flatMap(request => request.items.flatMap(item => item.productSku ? [{ id: item.productSku.id, label: item.productSku.partNumber }] : [])),
    projectId: requests.filter(request => request.project).map(request => ({ id: request.projectId!, label: request.project!.name })),
    opportunityId: requests.filter(request => request.opportunity).map(request => ({ id: request.opportunityId!, label: request.opportunity!.name })),
  };
  const filtered = summaries.filter(({ request, summary }) => matchesDemoReportRequest(request, summary, f));
  const rows = filtered.flatMap(({ request, summary }) => request.items.flatMap(item => item.units.filter(unit => matchesDemoReportUnit(item, unit, f)).map(unit => ({ request, item, unit, summary }))));
  const visibleRequestIds = new Set(rows.map(row => row.request.id));
  const scoped = filtered.filter(entry => visibleRequestIds.has(entry.request.id));
  const metrics = [
    ['Open Demo Requests', scoped.filter(entry => entry.summary.open).length],
    ['Units Currently Deployed', rows.filter(row => row.unit.deployedAt && !row.unit.returnedAt).length],
    ['Units Overdue', rows.filter(row => row.unit.deployedAt && !row.unit.returnedAt && row.summary.overdue).length],
    ['Units Requiring Recovery Attention', rows.filter(row => row.unit.deployedAt && !row.unit.returnedAt && row.summary.recoveryAttention).length],
    ['Returned Units', rows.filter(row => !!row.unit.returnedAt).length],
    ...(['Open','Won','Lost'] as const).map(result => [`Demos Associated with ${result} Opportunities`, scoped.filter(entry => opportunityResult(entry.request.opportunity) === result).length] as [string, number]),
  ] as [string, number][];
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.reports} title="Demo Inventory / Deployment" description="Physical units deployed to Accounts and associated sales context." action={<Link className="btn-secondary" href="/reports">Reports</Link>}/>
    <form className="panel filter-panel filter-grid filter-row mb-5" method="get">
      <label>Inventory state<select className="field mt-1 w-full" name="state" defaultValue={f.state ?? 'all'}><option value="all">All</option><option value="open">Open units</option><option value="returned">Returned units</option></select></label>
      <label>Overdue<select className="field mt-1 w-full" name="overdue" defaultValue={f.overdue ?? ''}><option value="">Any</option><option value="yes">Overdue</option></select></label>
      <label>Recovery attention<select className="field mt-1 w-full" name="recovery" defaultValue={f.recovery ?? ''}><option value="">Any</option><option value="yes">Needs attention</option></select></label>
      {([['accountId','Account'],['ownerId','Requester / rep'],['productId','Product'],['skuId','SKU'],['projectId','Project'],['opportunityId','Opportunity']] as const).map(([key,label]) => <label key={key}>{label}<select className="field mt-1 w-full" name={key} defaultValue={f[key] ?? ''}><option value="">Any</option>{[...new Map(choices[key].map(choice => [choice.id, choice])).values()].sort((a,b) => a.label.localeCompare(b.label)).map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>)}
      <label>Opportunity result<select className="field mt-1 w-full" name="opportunityResult" defaultValue={f.opportunityResult ?? ''}><option value="">Any</option><option>Open</option><option>Won</option><option>Lost</option></select></label>
      <label>Project status<select className="field mt-1 w-full" name="projectStatus" defaultValue={f.projectStatus ?? ''}><option value="">Any</option>{['PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Demo status<select className="field mt-1 w-full" name="demoStatus" defaultValue={f.demoStatus ?? ''}><option value="">Any</option>{['PENDING','APPROVED','SHIPPED','CANCELLED'].map(value => <option key={value} value={value}>{demoStatusLabel(value)}</option>)}</select></label>
      {[['deployedFrom','Deployed from'],['deployedTo','Deployed to'],['expectedFrom','Expected from'],['expectedTo','Expected to']].map(([key,label]) => <label key={key}>{label}<input className="field mt-1 w-full" type="date" name={key} defaultValue={f[key as keyof DemoReportFilters]}/></label>)}
      <button className="btn-primary self-end">Apply filters</button>
    </form>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([label,value]) => <div className="panel p-4" key={label}><div className="text-xs text-slate-600">{label}</div><strong className="text-xl">{value}</strong></div>)}</div>
    <p className="mb-3 text-sm text-slate-600">One row per logical unit. Blank serials are unassigned units, not additional inventory. Unit cost and deployed value are unavailable from current catalog data.</p>
    <div className="panel overflow-x-auto"><table className="w-full min-w-[1400px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-600"><tr>{['Demo','Account','Product / SKU','Serial','State','Deployed','Days','Expected return','Return','Outstanding','Returned','Context','Opportunity result','Requester'].map(value => <th className="px-3 py-2" key={value}>{value}</th>)}</tr></thead><tbody className="divide-y">{rows.map(({ request,item,unit,summary }) => <tr key={unit.id}><td className="px-3 py-2"><Link className="text-orange-800 underline" href={`/demos/${request.id}`}>{demoLabel(request)}</Link><span className="block text-xs">{demoStatusLabel(request.status)}</span></td><td className="px-3 py-2">{request.account.name}</td><td className="px-3 py-2">{item.productSku?.product.name ?? item.sourceSku}<span className="block text-xs">{item.productSku?.partNumber ?? item.sourceSku}</span></td><td className="px-3 py-2">{unit.serialNumber ?? 'Unassigned'}</td><td className="px-3 py-2">{unit.returnedAt ? 'Returned' : unit.deployedAt ? summary.overdue ? 'Overdue' : summary.recoveryAttention ? 'Return attention' : 'Deployed' : unit.status}</td><td className="px-3 py-2">{unit.deployedAt ? dateOnly(unit.deployedAt) : '—'}</td><td className="px-3 py-2">{daysDeployed(unit) ?? '—'}</td><td className="px-3 py-2">{summary.expected ? dateOnly(summary.expected) : '—'}</td><td className="px-3 py-2">{unit.returnedAt ? dateOnly(unit.returnedAt) : '—'}</td><td className="px-3 py-2">{unit.deployedAt && !unit.returnedAt ? 1 : 0}</td><td className="px-3 py-2">{unit.returnedAt ? 1 : 0}</td><td className="px-3 py-2">{request.project?.name ?? '—'} / {request.opportunity?.name ?? '—'}</td><td className="px-3 py-2">{opportunityResult(request.opportunity)}</td><td className="px-3 py-2">{request.requestedBy ? `${request.requestedBy.firstName} ${request.requestedBy.lastName}` : '—'}</td></tr>)}</tbody></table>{!rows.length && <p className="p-5 text-sm text-slate-500">No Demo units match these filters.</p>}</div>
  </Content>;
}
