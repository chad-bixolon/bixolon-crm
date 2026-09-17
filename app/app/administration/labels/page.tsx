import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { LabelForm } from "@/components/label-form";
import { defaultLabels, labelMap } from "@/lib/configuration";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function LabelsPage() {
  await requirePermission("users.manage");
  const rows = await prisma.terminologyLabel.findMany();
  const labels = labelMap(rows);
  return <Content><PageHeader eyebrow="Administration" title="Labels & Terminology" description="Edit friendly labels. Internal keys, stored values, and routes stay fixed." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">System labels</h2>{Object.keys(defaultLabels).map(key => <div key={key}><LabelForm key={`${key}-${labels[key as keyof typeof labels]}`} labelKey={key} value={labels[key as keyof typeof labels]} overridden={labels[key as keyof typeof labels] !== defaultLabels[key as keyof typeof defaultLabels]}/>{rows.find(row => row.key === key) && <p className="mb-4 text-xs text-slate-500">Last changed by user #{rows.find(row => row.key === key)?.changedById} at {rows.find(row => row.key === key)?.changedAt.toISOString()}</p>}</div>)}</section><p className="mt-4 text-sm text-slate-600">Each change records the editor ID and time, including restoring a default.</p></Content>;
}
