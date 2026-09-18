import Link from "next/link";
import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { LookupForm } from "@/components/lookup-form";
import { prisma } from "@/lib/prisma";
import { listLookups, lookupKind, lookupTitle } from "@/lib/lookups";
import { requirePermission } from "@/lib/current-user";
export const dynamic = "force-dynamic";
export default async function LookupPage({ params }: { params: Promise<{ kind: string }> }) {
  await requirePermission("users.manage");
  const { kind } = await params;
  if (!lookupKind(kind)) notFound();
  const values = await listLookups(prisma, kind);
  const title = lookupTitle(kind);
  return <Content><PageHeader eyebrow="Administration" title={`${title} values`} description={`Manage ${title.toLowerCase()} choices and display order.`} action={<Link className="btn-secondary" href="/administration">Administration</Link>}/>
    <section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Add {title.toLowerCase()}</h2><LookupForm kind={kind}/></section>
    <section className="panel p-5"><h2 className="mb-2 text-lg font-semibold">Existing values</h2><p className="mb-5 text-sm text-slate-600">Inactive values remain visible on existing records. Codes cannot be changed after creation. Values are never hard deleted.</p>
      <div className="space-y-5">{values.map((value) => <div className="border-t border-slate-200 pt-4" key={value.code}><div className="mb-2 flex flex-wrap gap-2 text-sm text-slate-600"><strong className="text-slate-900">{value.name}</strong><span>· {"products" in value._count ? value._count.products : "activities" in value._count ? value._count.activities : value._count.accounts} linked</span><span>· {value.active ? "Active" : "Inactive"}</span></div><LookupForm kind={kind} initial={value}/></div>)}{!values.length && <p className="text-sm text-slate-500">No values yet.</p>}</div>
    </section>
  </Content>;
}
