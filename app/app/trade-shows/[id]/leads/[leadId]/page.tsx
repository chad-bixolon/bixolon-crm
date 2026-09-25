import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { canEditTradeShowLead, tradeShowLeadReadWhere } from '@/lib/trade-shows';
import { canConvertTradeShowLead } from '@/lib/trade-show-conversion';
import type { TradeShowImportFormat, TradeShowLeadRouting, TradeShowLeadStatus } from '@prisma/client';
import { SaveSuccess } from '@/components/save-success';
import { saveFeedbackMessage } from '@/lib/save-feedback';

export const dynamic = 'force-dynamic';
const statusLabels: Record<TradeShowLeadStatus, string> = { NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', CONVERTED: 'Converted', DISQUALIFIED: 'Disqualified' };
const routingLabels:Record<TradeShowLeadRouting,string>={UNREVIEWED:'Unreviewed',BIXOLON_SALES:'BIXOLON Sales',REFERRED_TO_PARTNER:'Referred to Partner',MARKETING_FOLLOW_UP:'Marketing Follow-Up'};
const sourceFormatLabels: Record<TradeShowImportFormat, string> = { NRA_NRF: 'NRA / NRF', XPRESSLEADS_MODEX: 'MODEX / XPressLeads', CUSTOM_MAPPING: 'Custom mapping' };
export default async function TradeShowLeadPage({ params, searchParams }: { params: Promise<{ id: string; leadId: string }>; searchParams: Promise<{ saved?: string }> }) {
  const actor = await currentUser();
  const { id: rawShowId, leadId: rawLeadId } = await params;
  const tradeShowId = Number(rawShowId), id = Number(rawLeadId);
  if (!Number.isSafeInteger(tradeShowId) || tradeShowId < 1 || !Number.isSafeInteger(id) || id < 1) notFound();
  const lead = await prisma.tradeShowLead.findFirst({
    where: { AND: [{ id, tradeShowId }, tradeShowLeadReadWhere(actor)] },
    include: {
      tradeShow: { select: { name: true, archivedAt: true } }, assignedSalesRep: { select: { firstName: true, lastName: true } },
      firstImport: { select: { format: true, mappingName: true } },
      competitor: { select: { name: true } }, account: { select: { id: true, name: true } },
      routedPartnerAccount:{select:{id:true,name:true}}, referredBy:{select:{firstName:true,lastName:true}},
      contact: { select: { id: true, firstName: true, lastName: true } },
      convertedOpportunity: { select: { id: true, name: true, ownerId: true, owner: { select: { firstName: true, lastName: true } }, stage: { select: { name: true } } } },
    },
  });
  if (!lead) notFound();
  const when = (value: Date | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(value) : '—';
  const canLinkOpportunity = can(actor, 'sales.read') && (actor.role !== 'SALES' || lead.convertedOpportunity?.ownerId === actor.id);
  const canConvert = !lead.tradeShow.archivedAt && !lead.convertedOpportunityId && !!lead.accountId && canConvertTradeShowLead(actor, lead);
  const row = (label: string, value: React.ReactNode, fullWidth = false) => <div className={fullWidth ? 'min-w-0 sm:col-span-2' : 'min-w-0'}><dt className="label">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm text-slate-800">{value || '—'}</dd></div>;
  const saveMessage = saveFeedbackMessage((await searchParams).saved, 'Trade Show Lead');
  return <Content><PageHeader eyebrow={lead.tradeShow.name} title={`${lead.firstName} ${lead.lastName}`} description={`Trade Show Lead #${lead.id}`} action={<div className="flex flex-wrap justify-end gap-2"><Link className="btn-secondary" href={`/trade-shows/${tradeShowId}`}>Back to Trade Show</Link>{!lead.tradeShow.archivedAt && canEditTradeShowLead(actor, lead) && <Link className="btn-primary" href={`/trade-shows/${tradeShowId}/leads/${lead.id}/edit`}>Edit Lead</Link>}</div>}/>
    {saveMessage && <SaveSuccess message={saveMessage}/>}
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Lead</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Name', `${lead.firstName} ${lead.lastName}`)}{row('Title', lead.title)}{row('Email', lead.email)}{row('Phone', lead.phone)}</dl></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Company</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Source Company', lead.sourceCompany)}{row('Website', lead.sourceCompanyWebsite)}{row('Address', [lead.addressLine1, lead.addressLine2].filter(Boolean).join(', '))}{row('Location', [lead.city, lead.stateProvince, lead.postalCode, lead.country].filter(Boolean).join(', '))}</dl></section>
      <section className="panel border-orange-200 p-5"><h2 className="mb-4 text-lg font-semibold">Lead Routing</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Routing',routingLabels[lead.routing])}{row('Assigned Sales Rep',lead.assignedSalesRep ? `${lead.assignedSalesRep.firstName} ${lead.assignedSalesRep.lastName}` : 'Unassigned')}{row('Partner Account',lead.routedPartnerAccount?<Link className="text-orange-800 underline" href={`/accounts/${lead.routedPartnerAccount.id}`}>{lead.routedPartnerAccount.name}</Link>:'—')}{row('Referral Date',when(lead.referredAt))}{row('Referred By',lead.referredBy?`${lead.referredBy.firstName} ${lead.referredBy.lastName}`:'—')}{row('Referral Notes',lead.referralNotes,true)}</dl></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Status &amp; Follow-Up</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Status', statusLabels[lead.status])}{row('Follow-Up Date', when(lead.followUpAt))}{row('Last Contacted Date', when(lead.lastContactedAt))}{row('Sales Notes', lead.salesNotes, true)}</dl></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Customer Context</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Product Interest', lead.productInterest, true)}{row('Competitor Mentioned', lead.competitorSourceText)}{row('Resolved Competitor', lead.competitor?.name)}{row('Current Product Being Used', lead.currentProductBeingUsed, true)}{row('Customer Pain Points', lead.customerPainPoints, true)}</dl></section>
      <section className="panel p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">CRM Links</h2>{lead.account&&can(actor,'tasks.write')&&<Link className="btn-primary" href={`/activities/new?accountId=${lead.account.id}${lead.contact?`&contactId=${lead.contact.id}`:''}`}>Record Activity</Link>}</div><dl className="grid gap-4">{row('Account', lead.account ? <Link className="text-orange-800 underline" href={`/accounts/${lead.account.id}`}>{lead.account.name}</Link> : 'Not linked')}{row('Contact', lead.contact ? <Link className="text-orange-800 underline" href={`/contacts/${lead.contact.id}`}>{lead.contact.firstName} {lead.contact.lastName}</Link> : 'Not linked')}</dl>{!lead.account&&<p className="mt-4 text-xs text-slate-500">CRM Activities require a resolved Account. Lead status, follow-up date, and Sales Notes remain available without creating an Account.</p>}</section>
      <section className="panel min-w-0 max-w-full bg-slate-50/50 p-5"><h2 className="mb-4 text-lg font-semibold">Source &amp; Import Details</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Source Format', sourceFormatLabels[lead.firstImport.format])}{row('Import Mapping', lead.firstImport.mappingName)}{row('Captured', when(lead.capturedAt))}{row('Imported', when(lead.importedAt))}{row('Source File', lead.sourceFileName)}{row('Sheet / Row', `${lead.sourceSheet} / ${lead.sourceRow}`)}{row('Source Notes', lead.sourceNotes)}</dl><details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-orange-800">View original import data</summary><pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-3 text-xs">{JSON.stringify(lead.rawSourceData, null, 2)}</pre></details></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Conversion</h2>{lead.convertedOpportunity ? <><p className="mb-4"><span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Converted</span></p><dl className="grid gap-4">{row('Opportunity', canLinkOpportunity ? <Link className="text-orange-800 underline" href={`/opportunities/${lead.convertedOpportunity.id}`}>{lead.convertedOpportunity.name}</Link> : lead.convertedOpportunity.name)}{row('Account', lead.account?.name)}{row('Contact', lead.contact ? `${lead.contact.firstName} ${lead.contact.lastName}` : null)}{row('Owner', lead.convertedOpportunity.owner ? `${lead.convertedOpportunity.owner.firstName} ${lead.convertedOpportunity.owner.lastName}` : null)}{row('Stage', lead.convertedOpportunity.stage.name)}{row('Converted', when(lead.convertedAt))}</dl></> : canConvert ? <div><p><span className="inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">Ready to convert</span></p><p className="mt-3 text-sm text-slate-600">Review the sales details before creating an Opportunity.</p><Link className="btn-primary mt-4 inline-flex" href={`/trade-shows/${tradeShowId}/leads/${lead.id}/convert`}>Prepare Conversion</Link></div> : <div><p><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">Not ready to convert</span></p>{canConvertTradeShowLead(actor,lead)&&!lead.accountId ? <p className="mt-3 text-sm text-amber-800">Link an Account before preparing conversion.</p> : <p className="mt-3 text-sm text-slate-500">This lead has not been converted.</p>}</div>}</section>
    </div>
  </Content>;
}
