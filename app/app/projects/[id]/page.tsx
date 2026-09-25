import { operationalOpportunityWhere } from '@/lib/operational-where';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { ProjectArchiveControl } from '@/components/project-form';
import { RelatedWork } from '@/components/related-work';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { canEditProject, projectOpportunitiesWhere, projectReadWhere, projectRoleLabels, projectStatusLabels } from '@/lib/projects';
import { ProjectOpportunityLinks } from '@/components/project-opportunity-links';
import { changeProjectOpportunity } from './opportunity-actions';
import { SaveSuccess } from '@/components/save-success';
import { saveFeedbackMessage } from '@/lib/save-feedback';
import { DocumentsSection } from '@/components/documents-section';
export const dynamic = 'force-dynamic';
const tabs = ['Overview', 'Participants', 'Opportunities', 'Tasks', 'Activities', 'Notes', 'Documents', 'Products'] as const;
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; tasksView?: string; activitiesView?: string; notesView?: string; documentsView?: string; saved?: string }> }) {
  const actor = await currentUser(), id = Number((await params).id), query = await searchParams;
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const project = await prisma.project.findFirst({ where: { AND: [{ id }, projectReadWhere(actor)] }, include: {
    primaryAccount: { select: { id: true, name: true, ownerId: true } }, owner: true,
    participants: { include: { account: { select: { id: true, name: true } }, roles: true }, orderBy: { account: { name: 'asc' } } },
  } });
  if (!project) notFound();
  const canSeeSales = can(actor, 'sales.read'), canSeeWork = can(actor, 'tasks.read');
  const tab = tabs.find(t => t.toLowerCase() === query.tab?.toLowerCase()) ?? 'Overview';
  const opportunities = canSeeSales && (tab === 'Opportunities' || tab === 'Products') ? await prisma.opportunity.findMany({
    where: projectOpportunitiesWhere(id, tab === 'Products'), include: { stage: true, products: { where: { archivedAt: null }, include: { product: true } } },
    orderBy: [{ expectedCloseDate: 'asc' }, { id: 'desc' }],
  }) : [];
  const linkOptions = canSeeSales && can(actor, 'sales.write') && tab === 'Opportunities' ? await prisma.opportunity.findMany({ where: { AND: [operationalOpportunityWhere], projects: { none: { projectId: id } } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [];
  const productRows = opportunities.flatMap(o => o.products.map(line => ({ opportunity: o, line })));
  const editable = canEditProject(actor, project);
  const visibleTabs = tabs.filter(t => !(['Opportunities', 'Products'].includes(t) && !canSeeSales) && !(['Tasks', 'Activities', 'Notes'].includes(t) && !canSeeWork));
  const saveMessage = saveFeedbackMessage(query.saved, 'Project');
  return <Content><PageHeader eyebrow="Projects" title={project.name} description={`Project #${id}`} action={<div className="flex gap-2"><Link className="btn-secondary" href="/projects">All Projects</Link>{editable && !project.archivedAt && <Link className="btn-primary" href={`/projects/${id}/edit`}>Edit Project</Link>}</div>}/>
    {saveMessage && <SaveSuccess message={saveMessage}/>}
    <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 p-5"><div className="flex gap-2"><span className="rounded bg-slate-100 px-3 py-1 text-sm">{projectStatusLabels[project.status]}</span>{project.archivedAt && <span className="rounded bg-slate-100 px-3 py-1 text-sm">Archived</span>}</div>{editable && <ProjectArchiveControl id={id} archived={!!project.archivedAt}/>}</div>
    <nav aria-label="Project sections" className="mb-5 flex gap-1 overflow-x-auto border-b">{visibleTabs.map(t => <Link key={t} href={`/projects/${id}?tab=${t.toLowerCase()}`} aria-current={tab === t ? 'page' : undefined} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === t ? 'border-orange-600 text-orange-800' : 'border-transparent text-slate-600'}`}>{t}</Link>)}</nav>
    {tab === 'Overview' && <div className="panel p-6"><h2 className="mb-4 text-lg font-semibold">Overview</h2><dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <div><dt className="label">Primary Account</dt><dd>{project.primaryAccount ? <Link className="text-orange-800" href={`/accounts/${project.primaryAccountId}`}>{project.primaryAccount.name}</Link> : 'No primary account'}</dd></div>
      <div><dt className="label">Primary Account Role</dt><dd>{project.primaryAccount ? projectRoleLabels[project.primaryAccountRole] : '—'}</dd></div>
      <div><dt className="label">Owner</dt><dd>{project.owner ? `${project.owner.firstName} ${project.owner.lastName}` : 'Unassigned'}</dd></div>
      <div><dt className="label">Status</dt><dd>{projectStatusLabels[project.status]}</dd></div>
      <div><dt className="label">Start date</dt><dd>{project.startDate?.toISOString().slice(0,10) ?? '—'}</dd></div>
      <div><dt className="label">Target end date</dt><dd>{project.targetEndDate?.toISOString().slice(0,10) ?? '—'}</dd></div>
      <div className="sm:col-span-2"><dt className="label">Description</dt><dd className="whitespace-pre-wrap">{project.description || '—'}</dd></div>
    </dl></div>}
    {tab === 'Participants' && <div className="space-y-5"><section className="panel p-6"><h2 className="mb-3 text-lg font-semibold">Primary Account</h2>{project.primaryAccount ? <><Link className="text-orange-800" href={`/accounts/${project.primaryAccountId}`}>{project.primaryAccount.name}</Link><span className="ml-3 text-sm text-slate-600">{projectRoleLabels[project.primaryAccountRole]}</span></> : <p className="text-sm text-slate-500">No primary account.</p>}</section><section className="panel p-6"><h2 className="mb-3 text-lg font-semibold">Additional Participants ({project.participants.length})</h2>{project.participants.length ? <ul className="divide-y">{project.participants.map(p => <li key={p.accountId} className="flex flex-wrap justify-between gap-2 py-3"><Link className="text-orange-800" href={`/accounts/${p.accountId}`}>{p.account.name}</Link><span className="text-sm text-slate-600">{p.roles.map(r => projectRoleLabels[r.role]).join(', ')}</span></li>)}</ul> : <p className="text-sm text-slate-500">No additional participating Accounts.</p>}</section></div>}
    {tab === 'Opportunities' && canSeeSales && <section className="panel p-6"><h2 className="mb-4 text-lg font-semibold">Linked Opportunities ({opportunities.length})</h2>{opportunities.length ? <ul className="divide-y">{opportunities.map(o => <li key={o.id} className="flex justify-between gap-3 py-3 text-sm"><Link className="font-medium text-orange-800" href={`/opportunities/${o.id}`}>{o.name}</Link><span>{o.stage.name}{o.archivedAt ? ' · Archived' : ''}</span>{editable && can(actor, 'sales.write') && !project.archivedAt && <form action={async () => { 'use server'; const form = new FormData(); form.set('opportunityId', String(o.id)); form.set('operation', 'unlink'); await changeProjectOpportunity(id, {}, form); }}><button className="btn-secondary">Unlink</button></form>}</li>)}</ul> : <p className="text-sm text-slate-500">No Opportunities linked to this Project.</p>}{editable && can(actor, 'sales.write') && !project.archivedAt && <ProjectOpportunityLinks projectId={id} linkedIds={opportunities.map(o => o.id)} options={linkOptions}/>}</section>}
    {tab === 'Products' && canSeeSales && <section className="panel p-6"><h2 className="mb-3 text-lg font-semibold">Products via Opportunities</h2>{productRows.length ? <ul className="divide-y">{productRows.map(({ opportunity, line }) => <li key={line.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{line.product.sku} · {line.product.name}</span><Link className="text-orange-800" href={`/opportunities/${opportunity.id}`}>{opportunity.name}</Link></li>)}</ul> : <p className="text-sm text-slate-500">No products on linked Opportunities.</p>}</section>}
    {tab === 'Tasks' && canSeeWork && <RelatedWork projectId={id} kind="tasks" visibility={query.tasksView} allowCreate={editable && !project.archivedAt}/>}
    {tab === 'Activities' && canSeeWork && <RelatedWork projectId={id} kind="activities" visibility={query.activitiesView} allowCreate={editable && !project.archivedAt}/>}
    {tab === 'Notes' && canSeeWork && <RelatedWork projectId={id} kind="notes" visibility={query.notesView} allowCreate={editable && !project.archivedAt}/>}
    {tab === 'Documents' && <DocumentsSection parentType="project" parentId={id} actor={actor} view={query.documentsView} basePath={`/projects/${id}?tab=documents`}/>}
  </Content>;
}
