import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { canEditTradeShowLead, tradeShowLeadReadWhere } from '@/lib/trade-shows';

export const dynamic = 'force-dynamic';
export default async function TradeShowLeadPage({ params }: { params: Promise<{ id: string; leadId: string }> }) {
  const actor = await currentUser();
  const { id: rawShowId, leadId: rawLeadId } = await params;
  const tradeShowId = Number(rawShowId), id = Number(rawLeadId);
  if (!Number.isSafeInteger(tradeShowId) || tradeShowId < 1 || !Number.isSafeInteger(id) || id < 1) notFound();
  const lead = await prisma.tradeShowLead.findFirst({
    where: { AND: [{ id, tradeShowId }, tradeShowLeadReadWhere(actor)] },
    include: {
      tradeShow: { select: { name: true, archivedAt: true } }, assignedSalesRep: { select: { firstName: true, lastName: true } },
      firstImport: { select: { format: true } },
      competitor: { select: { name: true } }, account: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      convertedOpportunity: { select: { id: true, name: true, ownerId: true, owner: { select: { firstName: true, lastName: true } }, stage: { select: { name: true } } } },
    },
  });
  if (!lead) notFound();
  const when = (value: Date | null) => value ? `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';
  const canLinkOpportunity = can(actor, 'sales.read') && (actor.role !== 'SALES' || lead.convertedOpportunity?.ownerId === actor.id);
  const row = (label: string, value: React.ReactNode) => <div><dt className="label">{label}</dt><dd className="whitespace-pre-wrap text-sm text-slate-800">{value || '—'}</dd></div>;
  return <Content><PageHeader eyebrow={lead.tradeShow.name} title={`${lead.firstName} ${lead.lastName}`} description={`Trade Show Lead #${lead.id}`} action={<div className="flex gap-2"><Link className="btn-secondary" href={`/trade-shows/${tradeShowId}`}>Back to Trade Show</Link>{!lead.tradeShow.archivedAt && canEditTradeShowLead(actor, lead) && <Link className="btn-primary" href={`/trade-shows/${tradeShowId}/leads/${lead.id}/edit`}>Edit Lead</Link>}</div>}/>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Lead</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Name', `${lead.firstName} ${lead.lastName}`)}{row('Title', lead.title)}{row('Email', lead.email)}{row('Phone', lead.phone)}</dl></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Company</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Source Company', lead.sourceCompany)}{row('Website', lead.sourceCompanyWebsite)}{row('Address', [lead.addressLine1, lead.addressLine2].filter(Boolean).join(', '))}{row('Location', [lead.city, lead.stateProvince, lead.postalCode, lead.country].filter(Boolean).join(', '))}</dl></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Assigned Sales Rep</h2><p className="text-sm">{lead.assignedSalesRep ? `${lead.assignedSalesRep.firstName} ${lead.assignedSalesRep.lastName}` : 'Unassigned'}</p></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Status / Follow-Up</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Status', lead.status)}{row('Follow-up', when(lead.followUpAt))}{row('Last Contacted', when(lead.lastContactedAt))}{row('Sales Notes', lead.salesNotes)}</dl></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Customer Context</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Product Interest', lead.productInterest)}{row('Competitor', lead.competitor?.name ?? lead.competitorSourceText)}{row('Current Product Being Used', lead.currentProductBeingUsed)}{row('Customer Pain Points', lead.customerPainPoints)}</dl></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">CRM Links</h2><dl className="grid gap-4">{row('Account', lead.account ? <Link className="text-orange-800 underline" href={`/accounts/${lead.account.id}`}>{lead.account.name}</Link> : null)}{row('Contact', lead.contact ? <Link className="text-orange-800 underline" href={`/contacts/${lead.contact.id}`}>{lead.contact.firstName} {lead.contact.lastName}</Link> : null)}</dl></section>
      <section className="panel min-w-0 max-w-full p-5"><h2 className="mb-4 text-lg font-semibold">Source Details / Provenance</h2><dl className="grid gap-4 sm:grid-cols-2">{row('Format', lead.firstImport.format)}{row('Captured', when(lead.capturedAt))}{row('Imported', when(lead.importedAt))}{row('File', lead.sourceFileName)}{row('Sheet / Row', `${lead.sourceSheet} / ${lead.sourceRow}`)}{row('Source Notes', lead.sourceNotes)}</dl><details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-orange-800">Original source fields</summary><pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-xs">{JSON.stringify(lead.rawSourceData, null, 2)}</pre></details></section>
      <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold">Conversion Summary</h2>{lead.convertedOpportunity ? <dl className="grid gap-4">{row('Opportunity', canLinkOpportunity ? <Link className="text-orange-800 underline" href={`/opportunities/${lead.convertedOpportunity.id}`}>{lead.convertedOpportunity.name}</Link> : lead.convertedOpportunity.name)}{row('Owner', lead.convertedOpportunity.owner ? `${lead.convertedOpportunity.owner.firstName} ${lead.convertedOpportunity.owner.lastName}` : null)}{row('Stage', lead.convertedOpportunity.stage.name)}{row('Converted', when(lead.convertedAt))}</dl> : <p className="text-sm text-slate-500">This lead has not been converted.</p>}</section>
    </div>
  </Content>;
}
