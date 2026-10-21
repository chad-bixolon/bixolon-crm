import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { CaseTimelineEntry } from '@/components/support-case-timeline';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { caseHistoryFilters, caseHistoryPage } from '@/lib/support-case-history';
import { supportUserZone } from '@/lib/support-case-ui';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';

export const dynamic = 'force-dynamic';
export default async function CaseHistoryPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const actor = await requirePermission('support-cases.read');
  const id = Number((await params).id), query = await searchParams;
  const zone = await supportUserZone(actor);
  const result = await caseHistoryPage(prisma, actor, id, query, zone);
  if (!result) notFound();
  const href = (page: number, type = result.type) => `/support/cases/${id}/history?${new URLSearchParams({ type, page: String(page) })}`;
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.support} title="Case History"
    description={`${result.row.caseNumber} · ${result.row.subject}${result.row.archivedAt ? ' · Archived Case' : result.row.status === 'CLOSED' ? ' · Closed Case' : ''}`}
    action={<Link className="btn-secondary" href={`/support/cases/${id}`}>Back to Case</Link>}/>
    <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="text-sm text-slate-600">Newest first · Recent and older activity</p>
      <nav className="flex flex-wrap gap-2" aria-label="History filters">{Object.entries(caseHistoryFilters).map(([type, label]) =>
        <Link key={type} className={type === result.type ? 'btn-primary' : 'btn-secondary'} aria-current={type === result.type ? 'page' : undefined} href={href(1, type as typeof result.type)}>{label}</Link>)}</nav>
    </div>
    <section className="panel min-w-0 p-4 sm:p-5" aria-label="Case history entries">
      {result.items.length ? <ol className="divide-y divide-slate-100">{result.items.map(item => <CaseTimelineEntry key={item.key} zone={zone}
        item={item.noteHref ? { ...item, noteHref: `${item.noteHref}?${new URLSearchParams({ page: String(result.page), type: result.type })}` } : item}/>)}</ol>
        : <p className="text-sm text-slate-500">No history entries for this view.</p>}
    </section>
    <nav aria-label="History pages" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <span>{result.count} {result.count === 1 ? 'entry' : 'entries'} · Page {result.page} of {result.pages}</span>
      {result.page > 1 && <Link className="btn-secondary" href={href(result.page - 1)}>Previous</Link>}
      {result.page < result.pages && <Link className="btn-secondary" href={href(result.page + 1)}>Next</Link>}
    </nav>
  </Content>;
}
