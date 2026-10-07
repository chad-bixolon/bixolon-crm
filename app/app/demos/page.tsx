import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { demoSummary } from '@/lib/demo-operations';
import { demoStatusLabel } from '@/lib/demo-display';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
const displayDate = (value: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(value);

export default async function DemosPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requirePermission('users.manage');
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 100);
  const status = ['PENDING', 'APPROVED', 'SHIPPED', 'CANCELLED'].includes(params.status ?? '') ? params.status as 'PENDING' | 'APPROVED' | 'SHIPPED' | 'CANCELLED' : undefined;
  const [rows, metricRequests] = await Promise.all([
    prisma.demoRequest.findMany({
      where: { ...(status ? { status } : {}), ...(q ? { OR: [{ demoNumber: { contains: q, mode: 'insensitive' } }, { shippingCarrier: { contains: q, mode: 'insensitive' } }, { carrierAccountNumber: { contains: q, mode: 'insensitive' } }, { account: { name: { contains: q, mode: 'insensitive' } } }, { requestedBy: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }] } }, { items: { some: { OR: [{ sourceSku: { contains: q, mode: 'insensitive' } }, { trackingNumbers: { array_contains: [q] } }, { productSku: { partNumber: { contains: q, mode: 'insensitive' } } }] } } }, ...(/^[0-9a-f-]{36}$/i.test(q) ? [{ sourceRequestId: q }] : [])] } : {}) },
      include: { account: { select: { name: true } }, requestedBy: { select: { firstName: true, lastName: true } }, items: { where: { retiredAt: null }, select: { sourceSku: true, quantity: true } } },
      orderBy: { requestedAt: 'desc' }, take: 200,
    }),
    prisma.demoRequest.findMany({ select: { status: true, shippedAt: true, durationValue: true, durationUnit: true, expectedReturnOverrideAt: true, project: { select: { status: true, archivedAt: true } }, opportunity: { select: { stage: { select: { isClosed: true, isWon: true } } } }, items: { select: { quantity: true, retiredAt: true, units: { select: { id: true, ordinal: true, serialNumber: true, status: true, deployedAt: true, returnedAt: true, inventoryLocation: true } } } } } }),
  ]);
  const summaries = metricRequests.map(request => demoSummary(request));
  const metrics = [
    ['Total demos', metricRequests.length],
    ['Open demos', summaries.filter(summary => summary.open).length],
    ['Shipped', metricRequests.filter(request => request.status === 'SHIPPED').length],
    ['Overdue', summaries.filter(summary => summary.overdue).length],
  ] as const;

  return <Content>
    <PageHeader eyebrow="Sales" title="Demo Requests" description="Track imported demo requests, shipment status, and deployed units." action={<Link className="btn-secondary" href="/administration/imports/demos">Import demos</Link>}/>
    <form className="panel filter-panel filter-grid filter-row mb-5" method="get">
      <label className="min-w-64 flex-1"><span className="sr-only">Search demos</span><input className="field w-full" name="q" placeholder="Search demo #, customer, requester, or SKU" defaultValue={q}/></label>
      <label className="w-44 max-w-full"><span className="label">Status</span><select className="field w-full" name="status" defaultValue={status ?? ''}><option value="">All statuses</option><option value="PENDING">Requested</option><option value="APPROVED">Approved</option><option value="SHIPPED">Shipped</option><option value="CANCELLED">Cancelled</option></select></label>
      <button className="btn-secondary h-11">Search</button>
    </form>
    <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Demo summary">{metrics.map(([label, value]) => <div className="panel px-4 py-2" key={label}><p className="text-xs text-slate-600">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p></div>)}</div>
    <div className="panel divide-y">{rows.map(row => {
      const hasNumber = !!row.demoNumber;
      const customer = row.account?.name ?? 'No Customer Account';
      const requester = row.requestedBy ? `${row.requestedBy.firstName} ${row.requestedBy.lastName}` : 'Requester unassigned';
      return <Link href={`/demos/${row.id}`} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-orange-50" key={row.id}>
        <div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{row.demoNumber || customer}</p><p className="truncate text-xs text-slate-600">{hasNumber ? customer : 'No demo number yet'} · Requested by {requester} · {displayDate(row.requestedAt)}</p><p className="truncate text-sm text-slate-700">{row.items.length ? row.items.map(item => `${item.sourceSku} × ${item.quantity}`).join(' · ') : 'No items'}</p></div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{demoStatusLabel(row.status)}</span>
      </Link>;
    })}{!rows.length && <p className="p-5 text-sm text-slate-600">No Demo Requests found.</p>}</div>
  </Content>;
}
