import Link from "next/link";
import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { ArchiveCrmControl, CrmStateControl } from "@/components/crm-state-control";
import { prisma } from "@/lib/prisma";
import { marketingPreferenceLabels } from "@/lib/contacts";
import { SaveSuccess } from "@/components/save-success";
import { saveFeedbackMessage } from "@/lib/save-feedback";
import { currentUser } from "@/lib/current-user";
import { can, taskScope } from "@/lib/authorization";
import { effectiveContactAddress, usesAccountAddress } from "@/lib/address";
import { contactAttribution, canManageAttribution } from "@/lib/marketing-attribution";
import { MarketingAttributionCard } from "@/components/marketing-attribution-card";
export const dynamic = "force-dynamic";
export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const c = await prisma.contact.findUnique({ where: { id }, include: { account: true, marketingPreferenceUpdatedBy: true } }); if (!c) notFound();
  const actor = await currentUser();
  const attribution = await contactAttribution(prisma, id);
  const [sources, campaigns] = canManageAttribution(actor) ? await Promise.all([prisma.leadSourceOption.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }), prisma.marketingCampaign.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } })]) : [[], []];
  const followUpTasks = await prisma.task.findMany({ where: { contactId: id, archivedAt: null, ...taskScope(actor) }, orderBy: [{ dueDate: 'asc' }, { id: 'desc' }], take: 10, select: { id: true, subject: true, status: true, dueDate: true } });
  const state = c.archivedAt ? "archived" : c.active ? "active" : "inactive";
  const saveMessage = saveFeedbackMessage((await searchParams).saved, 'Contact');
  const address = effectiveContactAddress(c);
  const accountAddress = usesAccountAddress(c);
  return <Content><PageHeader eyebrow="Contacts" title={`${c.firstName} ${c.lastName}`} description={`Contact #${id}`} action={<div className="flex gap-2"><Link className="btn-secondary" href="/contacts">All contacts</Link>{can(actor, 'contacts.write') && !c.archivedAt && <Link className="btn-primary" href={`/contacts/${id}/edit`}>Edit contact</Link>}</div>}/>
    {saveMessage && <SaveSuccess message={saveMessage}/>}
    <div className="panel mb-5 flex flex-wrap items-center gap-3 p-5"><span className="rounded bg-slate-100 px-3 py-1 text-sm">{state === "active" ? "Active" : state === "inactive" ? "Inactive" : "Archived"}</span>{c.isPrimary && <span className="rounded bg-orange-50 px-3 py-1 text-sm text-orange-800">Primary contact</span>}{can(actor, 'contacts.write') && <CrmStateControl kind="contact" id={id} state={state}/>}{can(actor, 'contacts.write') && !c.archivedAt && <ArchiveCrmControl kind="contact" id={id}/>}</div>
    <div className="panel p-6"><dl className="grid gap-5 sm:grid-cols-2">{[["Account", c.account ? <Link key="account" className="text-orange-800 underline" href={`/accounts/${c.accountId}`}>{c.account.name}</Link> : "Unassigned"], ["Title", c.title ?? "—"], ["Email", c.email ? <a key="email" className="text-orange-800 underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"], ["Office phone", c.phone ?? "—"], ["Mobile phone", c.mobile ?? "—"], ["Marketing communications", <span key="preference"><span className="font-medium">{marketingPreferenceLabels[c.marketingPreference]}</span>{c.marketingPreferenceUpdatedAt&&<span className="mt-1 block text-xs text-slate-500">Updated {c.marketingPreferenceUpdatedAt.toISOString().slice(0,10)}{c.marketingPreferenceUpdatedBy?` by ${c.marketingPreferenceUpdatedBy.firstName} ${c.marketingPreferenceUpdatedBy.lastName}`:""}</span>}</span>]].map(([label, value]) => <div key={String(label)}><dt className="label">{label}</dt><dd className="text-sm">{value}</dd></div>)}</dl></div>
    <div className="mt-5"><MarketingAttributionCard actor={actor} contactId={id} leadSource={attribution.leadSource} influences={attribution.influences} sources={sources} campaigns={campaigns}/></div>
    <div className="panel mt-5 p-6"><h2 className="mb-1 text-lg font-semibold">Address</h2><p className="mb-4 text-sm text-slate-600">{accountAddress ? <>Using <Link className="text-orange-800 underline" href={`/accounts/${c.accountId}`}>Account address</Link></> : "Contact-specific address"}</p><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[["Address line 1", address.addressLine1], ["Address line 2", address.addressLine2], ["City", address.city], ["State / Province", address.stateProvince], ["Postal code", address.postalCode], ["Country", address.country]].map(([label, value]) => <div key={label}><dt className="label">{label}</dt><dd className="text-sm">{value ?? "—"}</dd></div>)}</dl></div>
    {!!followUpTasks.length && <div className="panel mt-5 p-6"><h2 className="mb-4 text-lg font-semibold">Related Tasks</h2><ul className="divide-y">{followUpTasks.map(task => <li key={task.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><Link className="text-orange-800 underline" href={`/tasks/${task.id}`}>{task.subject}</Link><span className="text-slate-600">{task.status.replace('_', ' ')}{task.dueDate ? ` · Due ${task.dueDate.toISOString().slice(0, 10)}` : ''}</span></li>)}</ul></div>}
  </Content>;
}
