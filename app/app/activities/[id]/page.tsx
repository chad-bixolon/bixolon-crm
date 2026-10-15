import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { RecentView } from '@/components/recent-view';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { redirect } from 'next/navigation';
import { caseWorkContext } from '@/lib/support-work';
import { ActivityContext } from '@/components/activity-context';
import { can } from '@/lib/authorization';
import { formatEasternDateTime } from '@/lib/display-format';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';

export const dynamic = 'force-dynamic';

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!can(actor, 'tasks.read') && !can(actor, 'support-work.write')) redirect('/access-denied');
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const row = await prisma.activity.findUnique({ where: { id }, select: {
    subject: true, description: true, outcome: true, nextStep: true, followUpDate: true,
    activityDate: true, direction: true, archivedAt: true, supportCaseId: true,
    calendarReview: { select: { eventId: true } },
    activityType: { select: { name: true } }, user: { select: { firstName: true, lastName: true } },
    account: { select: { id: true, name: true } }, opportunity: { select: { id: true, name: true } },
    project: { select: { id: true, name: true } }, supportCase: { select: { id: true, caseNumber: true } },
    contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true } } } },
  } });
  if (!row) notFound();
  if (!can(actor, 'tasks.read')) {
    if (!row.supportCaseId) notFound();
    await caseWorkContext(prisma, actor, row.supportCaseId, undefined, [], true);
  }
  const fields = [['Type', row.activityType.name], ['Occurred', `${formatEasternDateTime(row.activityDate)} ET`], ['Direction', row.direction], ['Responsible user', row.user ? `${row.user.firstName} ${row.user.lastName}` : 'Unassigned'], ['Follow-up', row.followUpDate?.toISOString().slice(0, 10) ?? 'None']];
  const links = [
    ...row.contacts.map(({ contact }) => ({ label: 'Contact', name: `${contact.firstName} ${contact.lastName}`, href: `/contacts/${contact.id}` })),
  ];
  return <Content><RecentView entityType="ACTIVITY" recordId={id}/>
    <PageHeader title={row.subject} eyebrow={NAV_CATEGORIES.sales} action={<div className="page-header-actions"><Link className="btn-secondary" href="/">Dashboard</Link>{can(actor, 'tasks.write') && !row.archivedAt && <Link className="btn-primary" href={`/activities/${id}/edit`}>Edit activity</Link>}</div>}/>
    <section className="panel space-y-5 p-6">
      {row.archivedAt && <span className="rounded bg-slate-100 px-3 py-1 text-sm font-semibold">Archived</span>}
      {row.description && <p className="whitespace-pre-wrap break-words text-sm">{row.description}</p>}
      <dl className="grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="label">{label}</dt><dd className="break-words text-sm">{value}</dd></div>)}{links.map(link => <div key={link.href}><dt className="label">{link.label}</dt><dd className="break-words text-sm"><Link className="text-orange-800 underline" href={link.href}>{link.name}</Link></dd></div>)}</dl>
      <ActivityContext row={row} actor={actor}/>
      {row.outcome && <div><h2 className="label">Outcome</h2><p className="whitespace-pre-wrap break-words text-sm">{row.outcome}</p></div>}
      {row.nextStep && <div><h2 className="label">Next step</h2><p className="whitespace-pre-wrap break-words text-sm">{row.nextStep}</p></div>}
    </section>
  </Content>;
}
