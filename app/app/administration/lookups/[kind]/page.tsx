import Link from "next/link";
import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { LookupForm } from "@/components/lookup-form";
import { prisma } from "@/lib/prisma";
import { listLookups, lookupKind, lookupTitle } from "@/lib/lookups";
export const dynamic = "force-dynamic";
export default async function LookupPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!lookupKind(kind)) notFound();
  const values = await listLookups(prisma, kind);
  const title = lookupTitle(kind);
  return <Content><PageHeader eyebrow="Administration" title={`${title} values`} description={`Manage ${title.toLowerCase()} choices for Accounts.`} action={<Link className="btn-secondary" href="/administration">Administration</Link>}/>
    <section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Add {title.toLowerCase()}</h2><LookupForm kind={kind}/></section>
    <section className="panel p-5"><h2 className="mb-2 text-lg font-semibold">Existing values</h2><p className="mb-5 text-sm text-slate-600">Inactive values remain visible on Accounts already using them. Codes cannot be changed after creation.</p>
      <div className="space-y-5">{values.map((value) => <div className="border-t border-slate-200 pt-4" key={value.code}><div className="mb-2 flex flex-wrap gap-2 text-sm text-slate-600"><strong className="text-slate-900">{value.name}</strong><span>· {value._count.accounts} account{value._count.accounts === 1 ? "" : "s"}</span><span>· {value.active ? "Active" : "Inactive"}</span></div><LookupForm kind={kind} initial={value}/></div>)}{!values.length && <p className="text-sm text-slate-500">No values yet.</p>}</div>
    </section>
  </Content>;
}
