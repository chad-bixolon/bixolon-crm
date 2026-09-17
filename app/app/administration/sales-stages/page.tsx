import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { StageForm } from "@/components/stage-form";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function SalesStagesPage() {
  await requirePermission("users.manage");
  const stages = await prisma.salesStage.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { _count: { select: { opportunities: true } } } });
  return <Content><PageHeader eyebrow="Administration" title="Sales Stages" description="Edit names, order, probability, and stage state. Existing opportunities keep their stage ID. Changing a stage's closed or won state affects current pipeline views." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Add stage</h2><StageForm/></section><section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Existing stages</h2><div className="space-y-6">{stages.map(stage => <div className="border-t pt-4" key={stage.id}><p className="mb-3 text-sm text-slate-600">ID {stage.id} · {stage._count.opportunities} opportunities · Last changed {stage.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p><StageForm stage={stage}/></div>)}</div></section></Content>;
}
