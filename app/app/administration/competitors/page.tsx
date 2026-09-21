import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { CompetitorForm } from "@/components/competitor-form";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function CompetitorsPage() {
  await requirePermission("users.manage");
  const values = await prisma.competitorOption.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { opportunities: true } } } });
  return <Content><PageHeader eyebrow="Administration" title="Competitors" description="Manage competitor options available on Opportunities." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/>
    <section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Add competitor</h2><CompetitorForm/></section>
    <section className="panel p-5"><h2 className="mb-2 text-lg font-semibold">Existing competitors</h2><p className="mb-5 text-sm text-slate-600">Inactive competitors remain visible on existing Opportunities. Competitors are never hard deleted.</p>
      <div className="space-y-5">{values.map(value => <div className="border-t border-slate-200 pt-4" key={value.id}><div className="mb-2 flex flex-wrap gap-2 text-sm text-slate-600"><strong className="text-slate-900">{value.name}</strong><span>· {value._count.opportunities} linked</span><span>· {value.active ? "Active" : "Inactive"}</span></div><CompetitorForm initial={value}/></div>)}{!values.length && <p className="text-sm text-slate-500">No competitors yet.</p>}</div>
    </section>
  </Content>;
}
