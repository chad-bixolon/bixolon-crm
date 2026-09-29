import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { demoContextChoices } from '@/lib/demos';
import { createDemoRequest } from '../actions';

export default async function NewDemoPage({ searchParams }: { searchParams: Promise<{ accountId?: string; projectId?: string; opportunityId?: string }> }) {
  const actor = await requirePermission('sales.write');
  const query = await searchParams;
  const accountId = Number(query.accountId);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) notFound();
  const account = await prisma.account.findFirst({ where: { id: accountId, status: 'ACTIVE', archivedAt: null }, select: { id: true, name: true } });
  if (!account) notFound();
  const [{ projects, opportunities }, skus] = await Promise.all([
    demoContextChoices(prisma, actor, accountId),
    prisma.productSku.findMany({ where: { active: true, product: { active: true, archivedAt: null } }, select: { id: true, partNumber: true }, orderBy: { partNumber: 'asc' } }),
  ]);
  const projectId = projects.some(item => item.id === Number(query.projectId)) ? query.projectId : '';
  const opportunityId = opportunities.some(item => item.id === Number(query.opportunityId)) ? query.opportunityId : '';
  return <Content><PageHeader eyebrow="Demos" title="Add Demo" description={`For ${account.name}`} action={<Link className="btn-secondary" href={`/accounts/${accountId}?tab=demos`}>Account Demos</Link>}/><form action={createDemoRequest.bind(null, accountId)} className="panel max-w-2xl space-y-4 p-5"><p className="text-sm"><b>Account:</b> {account.name}</p><label className="block">Project (optional)<select className="field mt-1 w-full" name="projectId" defaultValue={projectId}><option value="">Not linked yet</option>{projects.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="block">Opportunity (optional)<select className="field mt-1 w-full" name="opportunityId" defaultValue={opportunityId}><option value="">Not linked yet</option>{opportunities.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><div className="space-y-3"><h2 className="font-semibold">Items</h2>{Array.from({ length: 5 }, (_, index) => <div className="grid gap-2 sm:grid-cols-[1fr_8rem]" key={index}><label className="block">{index === 0 ? 'Product SKU' : `Additional SKU ${index + 1}`}<select className="field mt-1 w-full" name="skuId" required={index === 0}><option value="">{index === 0 ? 'Choose SKU' : 'No additional item'}</option>{skus.map(item => <option value={item.id} key={item.id}>{item.partNumber}</option>)}</select></label><label className="block">Quantity<input className="field mt-1 w-full" type="number" min="1" name="quantity" defaultValue={index === 0 ? '1' : undefined} required={index === 0}/></label></div>)}</div><div className="flex gap-3"><label>Duration<input className="field mt-1 w-full" type="number" min="1" name="durationValue" defaultValue="1" required/></label><label>Unit<select className="field mt-1 w-full" name="durationUnit"><option value="week">Week</option><option value="month">Month</option><option value="day">Day</option></select></label></div><label className="block">Shipping address<textarea className="field mt-1 w-full" name="shippingAddress" rows={4}/></label><label className="block">Notes<textarea className="field mt-1 w-full" name="notes" rows={5}/></label><button className="btn-primary">Create pending request</button></form></Content>;
}
