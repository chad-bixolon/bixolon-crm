import { prisma } from "@/lib/prisma";
import { Content, PageHeader } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function HomePage() {
  const [active, strategic, opportunities, tasks] = await Promise.all([
    prisma.account.count({ where: { status: "ACTIVE" } }),
    prisma.account.count({ where: { status: "ACTIVE", strategicAccount: true } }),
    prisma.opportunity.count({ where: { archivedAt: null, stage: { isClosed: false } } }),
    prisma.task.count({ where: { archivedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);
  const metrics = [["Active accounts", active], ["Strategic accounts", strategic], ["Open opportunities", opportunities], ["Open tasks", tasks]] as const;
  return <Content><PageHeader eyebrow="CRM overview" title="Dashboard" description="A current view of records in the CRM database."/><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="panel p-6"><p className="text-sm font-medium text-slate-600">{label}</p><p className="mt-3 text-3xl font-semibold tabular-nums text-slate-950">{value}</p></div>)}</div></Content>;
}
