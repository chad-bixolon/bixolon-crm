import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { saveRosaBackfill } from './actions';

export default async function RosaBackfillPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requirePermission('users.manage');
  if (actor.role !== 'ADMIN') return <Content><p>Administrator access required.</p></Content>;
  const [{ error }, accounts, skus] = await Promise.all([
    searchParams,
    prisma.account.findMany({ where: { status: 'ACTIVE', archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.productSku.findMany({ where: { active: true, product: { active: true, archivedAt: null } }, select: { id: true, partNumber: true }, orderBy: { partNumber: 'asc' } }),
  ]);
  return <Content><PageHeader eyebrow="Administration → Imports → Demo Requests" title="Add existing Demo record" description="Use this only to add a Demo that already exists in the source system." action={<Link className="btn-secondary" href="/administration/imports/demos">Import demos</Link>}/>
    {error && <p role="alert" className="mb-4 rounded bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <form action={saveRosaBackfill} className="panel max-w-4xl space-y-5 p-6 text-sm">
      <p className="rounded bg-amber-50 p-3 text-amber-900">Enter values from the existing source record. A real Source Request ID is required and checked against imported and manually entered Demos. A matching ID opens the existing Demo for reconciliation.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Source Request ID *<input className="field mt-1 w-full" name="requestId" required placeholder="UUID from source record"/></label>
        <label>Demo Number (if assigned)<input className="field mt-1 w-full" name="demoNumber"/></label>
        <label>Source status *<select className="field mt-1 w-full" name="status" required><option value="">Choose status</option><option value="PENDING">Requested</option><option value="APPROVED">Approved</option><option value="SHIPPED">Shipped</option></select></label>
        <label>CRM Account *<select className="field mt-1 w-full" name="accountId" required><option value="">Choose Account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Source customer name (VAR column) *<input className="field mt-1 w-full" name="sourceAccount" required/></label>
        <label>Requested date *<input className="field mt-1 w-full" name="requestedAt" type="date" required/></label>
        <label>Source requester *<input className="field mt-1 w-full" name="requestedBy" required/></label>
        <label>Reviewed date<input className="field mt-1 w-full" name="reviewedAt" type="date"/></label>
        <label>Source reviewer<input className="field mt-1 w-full" name="reviewedBy"/></label>
        <label>Shipped date<input className="field mt-1 w-full" name="shippedAt" type="date"/></label>
        <label>Source shipper<input className="field mt-1 w-full" name="shippedBy"/></label>
        <label>Duration *<input className="field mt-1 w-full" name="durationValue" type="number" min="1" required/></label>
        <label>Duration unit *<select className="field mt-1 w-full" name="durationUnit"><option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option></select></label>
        <label>Shipping carrier<input className="field mt-1 w-full" name="shippingCarrier"/></label>
        <label>Carrier account number<input className="field mt-1 w-full" name="carrierAccountNumber"/></label>
      </div>
      <label className="block">Shipping address<textarea className="field mt-1 w-full" name="shippingAddress" rows={2}/></label>
      <section><h2 className="font-semibold">Source items / SKUs</h2><p className="text-slate-600">Use exact active CRM SKU part numbers. Separate multiple serials, tracking numbers, or locations with semicolons.</p><datalist id="rosa-skus">{skus.map(sku => <option key={sku.id} value={sku.partNumber}/>)}</datalist>{Array.from({ length: 5 }, (_, i) => <div className="mt-3 grid gap-2 rounded border p-3 sm:grid-cols-2" key={i}><label>SKU {i + 1}{i === 0 ? ' *' : ''}<input className="field mt-1 w-full" name={`sku${i}`} list="rosa-skus" required={i === 0}/></label><label>Quantity<input className="field mt-1 w-full" name={`quantity${i}`} type="number" min="1" required={i === 0}/></label><label>Serial numbers<input className="field mt-1 w-full" name={`serials${i}`}/></label><label>Tracking numbers<input className="field mt-1 w-full" name={`tracking${i}`}/></label><label>Inventory locations<input className="field mt-1 w-full" name={`locations${i}`}/></label></div>)}</section>
      <label className="block">Source notes / comments<textarea className="field mt-1 w-full" name="notes" rows={3}/></label>
      <label className="block">Source approval comments<textarea className="field mt-1 w-full" name="approvalComments" rows={2}/></label>
      <label className="block">Reason for manual entry (optional)<textarea className="field mt-1 w-full" name="reason" rows={2}/></label>
      <button className="btn-primary">Add existing Demo record</button>
    </form>
  </Content>;
}
