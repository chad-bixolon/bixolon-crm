import { HelpLink } from '@/components/help-link';
import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { OutcomeReasonForm } from "@/components/outcome-reason-form";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function OutcomeReasonsPage() {
  await requirePermission("configuration.manage");
  const values = await prisma.outcomeReason.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { opportunities: true } } } });
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Outcome Reasons" description="Choose the reasons available when closing an Opportunity as won or lost." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><div className="mb-3"><HelpLink topic="manage-choices">Help with choices and stages</HelpLink></div>
    <section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Add Outcome Reason</h2><OutcomeReasonForm/></section>
    <section className="panel p-5"><h2 className="mb-2 text-lg font-semibold">Existing Outcome Reasons</h2><p className="mb-5 text-sm text-slate-600">Inactive reasons remain visible on existing Opportunities. Selected names and historical references are preserved when renamed. Reasons remain available in history. Lower display order numbers appear first.</p>
      <div className="space-y-5">{values.map(value => <div className="border-t border-slate-200 pt-4" key={value.id}><div className="mb-2 flex flex-wrap gap-2 text-sm text-slate-600"><strong className="text-slate-900">{value.name}</strong><span>· Closed {value.isWon ? "Won" : "Lost"}</span><span>· Used by {value._count.opportunities} Opportunities</span><span>· {value.active ? "Active" : "Inactive"}</span></div><OutcomeReasonForm initial={value}/></div>)}{!values.length && <p className="text-sm text-slate-500">No Outcome Reasons yet.</p>}</div>
    </section>
  </Content>;
}
