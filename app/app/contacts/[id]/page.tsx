import Link from "next/link";
import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { ArchiveCrmControl, CrmStateControl } from "@/components/crm-state-control";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const c = await prisma.contact.findUnique({ where: { id }, include: { account: true } }); if (!c) notFound();
  const state = c.archivedAt ? "archived" : c.active ? "active" : "inactive";
  return <Content><PageHeader eyebrow="Contacts" title={`${c.firstName} ${c.lastName}`} description={`Contact #${id}`} action={<div className="flex gap-2"><Link className="btn-secondary" href="/contacts">All contacts</Link>{!c.archivedAt && <Link className="btn-primary" href={`/contacts/${id}/edit`}>Edit contact</Link>}</div>}/>
    <div className="panel mb-5 flex flex-wrap items-center gap-3 p-5"><span className="rounded bg-slate-100 px-3 py-1 text-sm">{state}</span>{c.isPrimary && <span className="rounded bg-orange-50 px-3 py-1 text-sm text-orange-800">Primary contact</span>}<CrmStateControl kind="contact" id={id} state={state}/>{!c.archivedAt && <ArchiveCrmControl kind="contact" id={id}/>}</div>
    <div className="panel p-6"><dl className="grid gap-5 sm:grid-cols-2">{[["Account", <Link key="account" className="text-orange-800 underline" href={`/accounts/${c.accountId}`}>{c.account.name}</Link>], ["Title", c.title ?? "—"], ["Email", c.email ? <a key="email" className="text-orange-800 underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"], ["Office phone", c.phone ?? "—"], ["Mobile phone", c.mobile ?? "—"]].map(([label, value]) => <div key={String(label)}><dt className="label">{label}</dt><dd className="text-sm">{value}</dd></div>)}</dl></div>
  </Content>;
}
