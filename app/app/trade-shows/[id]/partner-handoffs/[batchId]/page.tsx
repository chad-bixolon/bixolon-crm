import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { PartnerHandoffExport } from '@/components/partner-handoff-export';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { prisma } from '@/lib/prisma';
import { requireModuleEnabled } from '@/lib/module-availability';
import { loadPartnerBatch } from '@/lib/trade-show-partner-handoff';
export const dynamic = 'force-dynamic';
export default async function Batch({ params, searchParams }: { params: Promise<{ id: string; batchId: string }>; searchParams: Promise<{ page?: string }> }) {
  await requireModuleEnabled('TRADE_SHOWS');
  const actor = await currentUser(), p = await params, id = Number(p.id), batchId = Number(p.batchId);
  if (!can(actor,'trade-shows.read') || !Number.isSafeInteger(id) || id<1 || !Number.isSafeInteger(batchId) || batchId<1) notFound();
  const raw = (await searchParams).page, page = /^\d{1,6}$/.test(raw ?? '') ? Math.max(1,Number(raw)) : 1;
  const data = await loadPartnerBatch(prisma,actor,id,batchId,page), b = data.batch;
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.marketing} title="Partner Handoff" description={b.partnerName} action={<Link className="btn-secondary" href={`/trade-shows/${id}/partner-handoffs?partner=${b.partnerAccountId}`}>Partner Handoffs</Link>}/><section className="panel mb-5 space-y-3 p-5"><p><strong>Partner:</strong> {b.partnerName}</p><p><strong>Trade Show:</strong> {b.tradeShowName}</p><p><strong>Date/time:</strong> {b.handedOffAt.toISOString().replace('T',' ').slice(0,19)} UTC</p><p><strong>Completed by:</strong> {b.performedBy.firstName} {b.performedBy.lastName}</p><p><strong>Follow-up Owner:</strong> {b.task.originalAssignee ? `${b.task.originalAssignee.firstName} ${b.task.originalAssignee.lastName}` : '—'}</p><p><strong>Leads sent:</strong> {b.leadCount}</p><p><strong>Status:</strong> Sent to Partner</p>{can(actor,'tasks.read') && <p><Link className="text-orange-800 underline" href={`/tasks/${b.taskId}`}>Open follow-up Task</Link></p>}<p className="text-sm text-slate-600">This handoff preserves which leads were sent to {b.partnerName}, even if those leads are later reassigned or converted. Lead links show their current SalesHub details.</p>{can(actor,'trade-shows.partner-handoff') && <PartnerHandoffExport showId={id} batchId={batchId}/>}</section><section className="panel p-5"><h2 className="mb-3 text-lg font-semibold">Included leads</h2><ul className="divide-y">{data.items.map(({lead:l})=><li className="py-3" key={l.id}><Link className="font-medium text-orange-800 underline" href={`/trade-shows/${id}/leads/${l.id}`}>{l.firstName} {l.lastName}</Link><span className="ml-3 text-sm text-slate-600">{l.sourceCompany} · {l.status}</span></li>)}</ul><div className="mt-3 flex flex-wrap justify-between gap-3 text-sm"><span>{data.count} visible leads · Page {data.page} of {Math.ceil(data.count/20)||1}</span><div className="flex gap-2">{data.page>1&&<Link href={`?page=${data.page-1}`}>Previous</Link>}{data.page*20<data.count&&<Link href={`?page=${data.page+1}`}>Next</Link>}</div></div></section></Content>;
}
