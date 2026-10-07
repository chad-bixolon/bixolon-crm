import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { previewTargetSync } from '@/lib/sales-target-sync';
import { formatCurrency } from '@/lib/display-format';
import { quarters } from '@/lib/forecast';
import { confirmSyncAction } from './actions';

export const dynamic='force-dynamic';
type Filters={userId?:string;year?:string;currencyCode?:string;error?:string;saved?:string};
export default async function Page({searchParams}:{searchParams:Promise<Filters>}) {
  const actor=await requirePermission('sales-plan.manage');
  const f=await searchParams;
  const input={userId:Number(f.userId),year:Number(f.year),currencyCode:f.currencyCode??''};
  let preview:Awaited<ReturnType<typeof previewTargetSync>>|null=null,error='';
  try {preview=await previewTargetSync(prisma,actor,input);} catch(e) {error=e instanceof Error?e.message:'Preview unavailable.';}
  const fmt=(v:Prisma.Decimal|null)=>v===null?'—':formatCurrency(v,input.currencyCode);
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.sales} title="Sync Sales Targets" description="Review the official annual Sales Plan and forecast targets before confirming." action={<Link className="btn-secondary" href="/sales-plan">Sales Plan</Link>}/>
    <p className="panel mb-5 p-4 text-sm">Sales Targets are used by forecast coverage. Syncing divides the approved annual Sales Plan evenly across four quarters. This does not change the rep’s quarterly Sales Plan allocation.</p>
    {f.error&&<p role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-800">{f.error}</p>}
    {f.saved&&<p className="mb-4 rounded bg-green-50 p-3 text-green-800">Sales Targets reconciled. The current values are shown below.</p>}
    {error&&<p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">{error}</p>}
    {preview&&<section className="panel overflow-x-auto p-4"><div className="mb-4 grid gap-3 sm:grid-cols-3"><div><span className="label">Rep / period</span><p>{preview.owner.firstName} {preview.owner.lastName} · {preview.year} · {preview.currencyCode}</p></div><div><span className="label">Official Annual Sales Plan</span><p>{fmt(preview.annual)} · revision {preview.revision}</p></div><div><span className="label">Status</span><p>{preview.status}</p></div></div>
      <table className="w-full min-w-[650px] text-sm"><thead><tr>{['Quarter','Current Forecast Sales Target','Proposed Forecast Sales Target'].map(label=><th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{quarters.map((q,i)=><tr className="border-t" key={q}><td className="p-2">{q}</td><td className="p-2">{preview.current[i].length===1?fmt(preview.current[i][0].targetAmount):preview.current[i].length>1?`${preview.current[i].length} conflicting targets`:'—'}</td><td className="p-2">{preview.proposed?fmt(preview.proposed[i]):'—'}</td></tr>)}</tbody></table>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3"><p>Current Annual Target: <strong>{preview.current.flat().length?fmt(preview.currentAnnual):'—'}</strong></p><p>Proposed Annual Target: <strong>{fmt(preview.annual)}</strong></p><p>Plan minus current target: <strong>{fmt(preview.difference)}</strong></p></div>
      {preview.proposed&&preview.status!=='Conflict'&&<form action={confirmSyncAction} className="mt-5"><input type="hidden" name="userId" value={preview.owner.id}/><input type="hidden" name="year" value={preview.year}/><input type="hidden" name="currencyCode" value={preview.currencyCode}/><input type="hidden" name="planId" value={preview.planId}/><input type="hidden" name="snapshot" value={preview.snapshot}/><button className="btn-primary">Confirm Sales Target sync</button></form>}
      {preview.status==='Conflict'&&<p className="mt-4 text-sm text-red-800">Resolve duplicate active targets in Sales Target management before syncing.</p>}
    </section>}
  </Content>;
}
