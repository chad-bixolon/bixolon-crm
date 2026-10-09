import { RecoverableActionForm } from '@/components/recoverable-action-form';
import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { canManageAttribution } from '@/lib/marketing-attribution';
import { prisma } from '@/lib/prisma';
import { saveLeadSource } from '@/app/marketing/attribution/actions';
import { notFound } from 'next/navigation';

export default async function LeadSourcesPage() {
  const actor = await currentUser(); if (!canManageAttribution(actor)) notFound();
  const sources = await prisma.leadSourceOption.findMany({ include: { _count: { select: { contacts: true, tradeShowLeads: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.marketing} title="Lead Sources" description="Manage original source categories." action={<Link className="btn-secondary" href="/marketing/campaigns">Campaigns</Link>}/>
    <div className="space-y-3">{sources.map(source => <RecoverableActionForm key={source.id} action={saveLeadSource} className="panel flex flex-wrap items-end gap-3 p-4"><input type="hidden" name="id" value={source.id}/><label className="text-sm">Name<input className="field mt-1 block" name="name" defaultValue={source.name} maxLength={120} required/></label><label className="text-sm">Order<input className="field mt-1 block w-24" name="sortOrder" type="number" min={0} max={100000} defaultValue={source.sortOrder} required/></label><label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={source.active}/>Active</label><span className="text-xs text-slate-500">{source._count.contacts} Contacts · {source._count.tradeShowLeads} Leads{source.systemKey ? ' · Trade Show default' : ''}</span><button className="btn-secondary">Save</button></RecoverableActionForm>)}</div>
    <RecoverableActionForm action={saveLeadSource} className="panel mt-5 flex flex-wrap items-end gap-3 p-4"><label className="text-sm">New Lead Source<input className="field mt-1 block" name="name" maxLength={120} required/></label><label className="text-sm">Order<input className="field mt-1 block w-24" name="sortOrder" type="number" min={0} max={100000} defaultValue={sources.length + 1} required/></label><label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked/>Active</label><button className="btn-primary">Add</button></RecoverableActionForm>
  </Content>;
}
