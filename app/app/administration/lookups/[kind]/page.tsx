import { HelpLink } from '@/components/help-link';
import { NAV_CATEGORIES } from '../../../../lib/navigation-categories';
import Link from "next/link";
import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { LookupForm } from "@/components/lookup-form";
import { prisma } from "@/lib/prisma";
import { listLookups, lookupKind, lookupTitle } from "@/lib/lookups";
import { requirePermission } from "@/lib/current-user";
export const dynamic = "force-dynamic";
export default async function LookupPage({ params }: { params: Promise<{ kind: string }> }) {
  await requirePermission("configuration.manage");
  const { kind } = await params;
  if (!lookupKind(kind)) notFound();
  const values = await listLookups(prisma, kind);
  const title = lookupTitle(kind);
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title={({ industries: "Industries", territories: "Territories", "activity-types": "Activity Types", "product-categories": "Product Categories" })[kind]} description={`Choose the ${title.toLowerCase()} options available on ${kind === "product-categories" ? "Products" : kind === "activity-types" ? "Activities" : "Accounts"}.`} action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><div className="mb-3"><HelpLink topic="manage-choices">Help with choices and stages</HelpLink></div>
    <section className="panel mb-5 p-5"><h2 className="mb-4 text-lg font-semibold">Add {title.toLowerCase()}</h2><LookupForm kind={kind}/></section>
    <section className="panel p-5"><h2 className="mb-2 text-lg font-semibold">Existing choices</h2><p className="mb-5 text-sm text-slate-600">Inactive choices remain visible on existing records. Codes are stable references used by imports and cannot be changed after creation. Choices are kept for history. Lower display order numbers appear first.</p>
      <div className="space-y-5">{values.map((value) => <div className="border-t border-slate-200 pt-4" key={value.code}><div className="mb-2 flex flex-wrap gap-2 text-sm text-slate-600"><strong className="text-slate-900">{value.name}</strong><span>· {"products" in value._count ? value._count.products : "activities" in value._count ? value._count.activities : value._count.accounts} {"products" in value._count ? "Products" : "activities" in value._count ? "Activities" : "Accounts"} use this choice</span><span>· {value.active ? "Active" : "Inactive"}</span></div><LookupForm kind={kind} initial={value}/></div>)}{!values.length && <p className="text-sm text-slate-500">No choices yet. Add the first choice above.</p>}</div>
    </section>
  </Content>;
}
