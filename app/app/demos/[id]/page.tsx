import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/authorization';
import { demoContextChoices, demoLabel, demoReadWhere } from '@/lib/demos';
import { demoDatedBy, demoDisplayDate, demoDuration, demoStatusLabel } from '@/lib/demo-display';
import { dateOnly, demoSummary, opportunityResult } from '@/lib/demo-operations';
import { deployDemoUnits, recordDemoReturn, updateDemoContext, updateDemoExpectedReturn, updateDemoNotes } from '../actions';

export default async function DemoPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('sales.read'), { id } = await params;
  const demoId = Number(id);
  if (!Number.isSafeInteger(demoId) || demoId <= 0) notFound();
  const request = await prisma.demoRequest.findFirst({
    where: { id: demoId, AND: [demoReadWhere(actor)] },
    include: {
      account: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, status: true, archivedAt: true } },
      opportunity: { select: { id: true, name: true, stage: { select: { isClosed: true, isWon: true } } } },
      requestedBy: { select: { firstName: true, lastName: true } },
      reviewedBy: { select: { firstName: true, lastName: true } },
      shippedBy: { select: { firstName: true, lastName: true } },
      expectedReturnOverrideBy: { select: { firstName: true, lastName: true } },
      items: { include: {
        units: { include: { returnEvents: { include: { recordedBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } } } },
        productSku: { select: { partNumber: true, product: { select: { name: true } } } },
      } },
      revisions: { select: { id: true, createdAt: true, sourceFileName: true, contentHash: true, sourceRowNumbers: true, sourceRows: true, reviewedMappings: true, resolvedHeader: true, resolvedItems: true, sourceTimestamp: true, recordedBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!request) notFound();
  const name = (user: { firstName: string; lastName: string } | null) => user ? `${user.firstName} ${user.lastName}` : '—';
  const summary = demoSummary(request);
  const units = request.items.flatMap(item => item.units);
  const activeUnits = request.items.filter(item => !item.retiredAt).flatMap(item => item.units);
  const editable = can(actor, 'sales.write') && (actor.role !== 'SALES' || request.requestedById === actor.id);
  const choices = editable ? await demoContextChoices(prisma, actor, request.accountId) : { projects: [], opportunities: [] };
  const projects = request.project && !choices.projects.some(item => item.id === request.project!.id) ? [{ ...request.project }, ...choices.projects] : choices.projects;
  const opportunities = request.opportunity && !choices.opportunities.some(item => item.id === request.opportunity!.id) ? [{ ...request.opportunity }, ...choices.opportunities] : choices.opportunities;
  const result = request.opportunity ? opportunityResult(request.opportunity) : null;

  return <Content>
    <PageHeader eyebrow="Demos" title={demoLabel(request)} action={<Link href={`/accounts/${request.accountId}?tab=demos`} className="btn-secondary">Account Demos</Link>}/>
    <div className="panel grid gap-3 p-5 text-sm sm:grid-cols-2">
      <p><b>Status:</b> {demoStatusLabel(request.status)}</p>
      <p><b>Account:</b> <Link className="text-orange-800 underline" href={`/accounts/${request.accountId}`}>{request.account.name}</Link></p>
      <p><b>Project:</b> {request.project ? <Link className="text-orange-800 underline" href={`/projects/${request.project.id}`}>{request.project.name}</Link> : 'Not linked'}</p>
      <p><b>Opportunity:</b> {request.opportunity ? <Link className="text-orange-800 underline" href={`/opportunities/${request.opportunity.id}`}>{request.opportunity.name}</Link> : 'Not linked'}</p>
      <p><b>Requested:</b> {demoDatedBy(request.requestedAt, request.requestedBy)}</p>
      <p><b>Reviewed:</b> {demoDatedBy(request.reviewedAt, request.reviewedBy)}</p>
      <p><b>Shipped:</b> {demoDatedBy(request.shippedAt, request.shippedBy)}</p>
      <p><b>Duration:</b> {demoDuration(request.durationValue, request.durationUnit)}</p>
      <p><b>Carrier:</b> {request.shippingCarrier ?? '—'}</p>
      <p className="text-slate-600"><b>Carrier account:</b> {request.carrierAccountNumber ?? '—'}</p>
      <p className="sm:col-span-2 whitespace-pre-wrap"><b>Shipping address:</b> {request.shippingAddress ?? '—'}</p>
      {request.approvalComments?.trim() && <p className="sm:col-span-2 whitespace-pre-wrap"><b>Approval comments:</b> {request.approvalComments}</p>}
    </div>

    <section className="panel mt-5 p-5">
      <h2 className="font-semibold">Items</h2>
      {request.items.map(item => {
        const sku = item.productSku?.partNumber ?? item.sourceSku;
        const product = item.productSku?.product.name;
        return <div className="mt-3 border-t pt-3 text-sm" key={item.id}>
          <b>{product && product !== sku ? `${product} · ` : ''}{sku} × {item.quantity}</b>
          <p>Serials: {(item.serialNumbers as string[]).join('; ') || '—'}</p>
          <p>Tracking: {(item.trackingNumbers as string[]).join('; ') || '—'}</p>
        </div>;
      })}
    </section>

    <section className="panel mt-5 p-5 text-sm">
      <h2 className="font-semibold">Deployment status</h2>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Deployment summary">
        {([['Requested', summary.total], ['Deployed', summary.deployed], ['Outstanding', summary.outstanding], ['Returned', summary.returned]] as const).map(([label, value]) =>
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2" key={label}><span className="text-slate-600">{label}</span> <b className="tabular-nums">{value}</b></div>
        )}
      </div>
      {(summary.overdue || summary.recoveryAttention) && <p className="mt-2 text-amber-800">{summary.overdue && 'Overdue'}{summary.overdue && summary.recoveryAttention && ' · '}{summary.recoveryAttention && 'Return attention'}</p>}
      <p className="mt-3"><b>Expected return:</b> {summary.expected ? demoDisplayDate(summary.expected) : '—'}</p>
      {request.expectedReturnOverrideAt && summary.calculated && <p className="text-slate-600">Originally calculated: {demoDisplayDate(summary.calculated)}</p>}
      {request.expectedReturnOverrideAt && (request.expectedReturnOverrideRecordedAt || request.expectedReturnOverrideBy || request.expectedReturnOverrideReason) && <p className="text-xs text-slate-500">Override{request.expectedReturnOverrideRecordedAt ? ` recorded ${demoDisplayDate(request.expectedReturnOverrideRecordedAt)}` : ''}{request.expectedReturnOverrideBy ? ` · ${name(request.expectedReturnOverrideBy)}` : ''}{request.expectedReturnOverrideReason ? ` · ${request.expectedReturnOverrideReason}` : ''}</p>}
      {result && result !== '—' && <p className="mt-2">Opportunity result: {result}</p>}
      <div className="mt-3 space-y-2">
        {request.items.flatMap(item => item.units.map(unit => <div className="rounded border border-slate-200 p-2" key={unit.id}>
          <b>{item.productSku?.partNumber ?? item.sourceSku}</b> · {unit.serialNumber ?? `Unassigned unit ${unit.ordinal}`} · {unit.returnedAt ? `Returned ${demoDisplayDate(unit.returnedAt)}` : unit.deployedAt ? `Deployed ${demoDisplayDate(unit.deployedAt)}` : demoStatusLabel(unit.status)}
          {unit.returnEvents.map(event => <p className="text-xs text-slate-600" key={event.id}>Return recorded {demoDisplayDate(event.returnedAt)} by {name(event.recordedBy)}{event.trackingNumber ? ` · Tracking ${event.trackingNumber}` : ''}{event.note ? ` · ${event.note}` : ''}</p>)}
        </div>))}
      </div>
      {editable && <>
        <form action={deployDemoUnits.bind(null, request.id)} className="mt-4 space-y-2">
          <h3 className="font-semibold">Record deployment</h3>
          <div className="flex flex-wrap gap-3">{activeUnits.filter(unit => !unit.deployedAt).map(unit => <label key={unit.id}><input type="checkbox" name="unitId" value={unit.id}/> {unit.serialNumber ?? `Unit ${unit.ordinal}`}</label>)}</div>
          <input className="field" type="date" name="deployedAt" required/><button className="btn-secondary ml-2">Record deployment</button>
        </form>
        <form action={recordDemoReturn.bind(null, request.id)} className="mt-4 space-y-2">
          <h3 className="font-semibold">Record return</h3>
          <div className="flex flex-wrap gap-3">{units.filter(unit => unit.deployedAt && !unit.returnedAt).map(unit => <label key={unit.id}><input type="checkbox" name="unitId" value={unit.id}/> {unit.serialNumber ?? `Unit ${unit.ordinal}`}</label>)}</div>
          <input className="field" type="date" name="returnedAt" required/><input className="field ml-2" name="trackingNumber" placeholder="Return tracking (optional)"/><input className="field ml-2" name="note" placeholder="Return note (optional)"/><button className="btn-secondary ml-2">Record return</button>
        </form>
        <form action={updateDemoExpectedReturn.bind(null, request.id)} className="mt-4 space-y-2">
          <h3 className="font-semibold">Expected return</h3>
          <input className="field" type="date" name="expectedReturn" defaultValue={summary.expected ? dateOnly(summary.expected) : ''} required/><input className="field ml-2" name="reason" placeholder="Reason (optional)"/><button className="btn-secondary ml-2">Update date</button>
        </form>
      </>}
    </section>

    {editable && <form className="panel mt-5 space-y-3 p-5" action={updateDemoContext.bind(null, request.id)}>
      <h2 className="font-semibold">Business context</h2>
      <p className="text-sm text-slate-600">Link this demo to a Project or Opportunity when applicable.</p>
      <label className="block">Project<select className="field mt-1 w-full" name="projectId" defaultValue={request.projectId ?? ''}><option value="">Not linked</option>{projects.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label className="block">Opportunity<select className="field mt-1 w-full" name="opportunityId" defaultValue={request.opportunityId ?? ''}><option value="">Not linked</option>{opportunities.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <button className="btn-secondary">Update links</button>
    </form>}
    {editable ? <form className="panel mt-5 p-4" action={updateDemoNotes.bind(null, request.id)}><h2 className="font-semibold">Notes</h2><label className="sr-only" htmlFor="demo-notes">Notes</label><textarea className="field mt-2 w-full text-sm font-normal leading-5" id="demo-notes" name="notes" rows={5} defaultValue={request.notes ?? ''}/><button className="btn-secondary mt-3">Save notes</button></form> : <section className="panel mt-5 p-4"><h2 className="font-semibold">Notes</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm font-normal leading-5 text-slate-700">{request.notes ?? '—'}</p></section>}
    {actor.role === 'ADMIN' && request.sourceRequestId && <section className="mt-5 text-xs text-slate-500">
      <p>Source method: {request.sourceMethod === 'MANUAL_ROSA_BACKFILL' ? 'Manual Rosa backfill' : 'Rosa CSV import'} · Source Request ID: {request.sourceRequestId}</p>
      <p>{request.revisions.length} source revision{request.revisions.length === 1 ? '' : 's'}</p>
      {request.revisions.map(revision => <details className="mt-3 rounded border border-slate-200 p-3" key={revision.id}>
        <summary className="cursor-pointer font-medium">{revision.sourceFileName} · {revision.createdAt.toISOString().slice(0, 16).replace('T', ' ')} · {revision.recordedBy.firstName} {revision.recordedBy.lastName}</summary>
        <p className="mt-2">Source timestamp: {revision.sourceTimestamp.toISOString()} · Digest: {revision.contentHash}</p>
        <p>Rows: {JSON.stringify(revision.sourceRowNumbers)}</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify({ sourceRows: revision.sourceRows, reviewedMappings: revision.reviewedMappings, resolvedHeader: revision.resolvedHeader, resolvedItems: revision.resolvedItems }, null, 2)}</pre>
      </details>)}
    </section>}
  </Content>;
}
