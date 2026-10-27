import { BulkSelection, BulkCheckbox, BulkPageCheckbox } from '@/components/bulk-selection';
import { listEligibleUserOptions } from '@/lib/assignment-eligibility';
import { HelpLink } from '@/components/help-link';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { qualityCounts, qualityIssue, qualityIssues, qualityPage, qualityBulkSupported, qualityPageSizeFor, qualityRows } from '@/lib/data-quality';
import { getModuleAvailability, qualityIssueAvailable } from '@/lib/module-availability';

export const dynamic = 'force-dynamic';
type Filters = { issue?: string; q?: string; page?: string };
function href(issue: string, q = '', page = 1) {
  const params = new URLSearchParams({ issue });
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  return `/administration/data-quality?${params}`;
}

export default async function DataQualityPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await requirePermission('data-quality.manage');
  if (actor.role !== 'ADMIN') notFound();
  const filters = await searchParams;
  const availability = await getModuleAvailability();
  const visibleIssues = qualityIssues.filter(issue => qualityIssueAvailable(issue.key, availability));
  const selected = qualityIssue(filters.issue);
  if (selected && !qualityIssueAvailable(selected.key, availability)) notFound();
  const q = typeof filters.q === 'string' ? filters.q.trim().slice(0, 100) : '';
  const requestedPage = qualityPage(filters.page);
  const [counts, initialResult] = await Promise.all([qualityCounts(prisma, availability), selected ? qualityRows(prisma, selected.key, q, requestedPage, availability) : Promise.resolve(null)]);
  const bulk = !!selected && qualityBulkSupported(selected.key);
  const pageSize = selected ? qualityPageSizeFor(selected.key) : 25;
  const pages = initialResult ? Math.max(1, Math.ceil(initialResult.count / pageSize)) : 1;
  const page = Math.min(requestedPage, pages);
  const result = selected && initialResult && page !== requestedPage ? await qualityRows(prisma, selected.key, q, page, availability) : initialResult;
  const owners = bulk ? await listEligibleUserOptions(prisma, selected?.key === 'opportunity-owner' ? 'opportunity-owner' : 'account-owner') : [];
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.administration} title="Data Quality" description="Review records that may need attention. A record may appear in more than one group." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><div className="mb-3"><HelpLink topic="data-quality">Help with Data Quality</HelpLink></div>
    <section className="panel mb-5 p-4 sm:p-5" aria-labelledby="quality-summary"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="quality-summary" className="text-lg font-semibold">Summary</h2><p className="mt-1 text-sm text-slate-600">{total} items to review across {visibleIssues.length} checks. Each check explains which records are included.</p></div>{availability.effective.has('PRICE_EXCEPTIONS') && <Link className="text-sm font-semibold text-orange-800 underline" href="/administration/price-exceptions">Review Price Exceptions →</Link>}</div></section>
    <section aria-labelledby="quality-groups"><h2 id="quality-groups" className="mb-3 text-lg font-semibold">Checks</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visibleIssues.map(issue => <Link key={issue.key} href={href(issue.key)} aria-current={selected?.key === issue.key ? 'page' : undefined} className={`panel flex min-w-0 flex-col p-4 hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-600 ${selected?.key === issue.key ? 'border-orange-400 bg-orange-50' : ''}`}><div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-slate-900">{issue.label}</h3><span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${counts[issue.key] ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{counts[issue.key]}</span></div><p className="mt-2 text-sm text-slate-600">{issue.explanation}</p><span className="mt-auto pt-3 text-sm font-semibold text-orange-800">View records →</span></Link>)}</div></section>
    {selected && result && <section className="mt-7" aria-labelledby="quality-results"><div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h2 id="quality-results" className="text-lg font-semibold">{selected.label} <span className="text-base font-normal text-slate-600">({result.count})</span></h2><p className="text-sm text-slate-600">{selected.explanation}</p></div><Link className="text-sm text-orange-800 underline" href="/administration/data-quality">All checks</Link></div>
      <form method="get" className="panel mb-3 flex flex-wrap items-end gap-3 p-4" role="search"><input type="hidden" name="issue" value={selected.key}/><div className="min-w-0 flex-1 sm:max-w-sm"><label className="label" htmlFor="quality-search">Search {selected.entity}</label><input className="field" id="quality-search" name="q" defaultValue={q} placeholder="Name, subject, or email"/></div><button className="btn-primary">Search</button>{q && <Link className="btn-secondary" href={href(selected.key)}>Clear search</Link>}</form>
      <BulkSelection key={`${selected.key}:${q}:${requestedPage}`} kind="quality" enabled={bulk} records={result.rows.flatMap(row => row.updatedAt ? [{ id: row.id, updatedAt: row.updatedAt }] : [])} assignees={owners.map(owner => ({ id: owner.id, name: `${owner.firstName} ${owner.lastName}` }))} qualityScope={{ issue: selected.key, q, page }}>
      <div className="panel overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>{bulk && <th className="px-2 py-1"><BulkPageCheckbox/></th>}<th className="px-4 py-3">Record</th><th className="px-4 py-3">Context</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y">{result.rows.map(row => <tr key={row.id} className="odd:bg-white even:bg-slate-50/60">{bulk && <td className="px-2 py-1"><BulkCheckbox id={row.id} label={row.name}/></td>}<td className="break-words px-4 py-3 font-medium">{row.name}</td><td className="break-words px-4 py-3 text-slate-600">{row.detail ?? '—'}</td><td className="px-4 py-3"><Link className="whitespace-nowrap font-semibold text-orange-800 underline" href={row.href}>Open record</Link></td></tr>)}</tbody></table>{!result.rows.length && <p className="p-6 text-center text-sm text-slate-600">{selected.key === 'account-owner-inactive' && !result.count ? 'No Accounts need owner reassignment for these filters.' : bulk && !result.count ? `No ${selected.entity} need an owner for these filters.` : q ? 'No records match this search. Clear the search or try another name.' : result.count ? 'No records on this page. Return to the first page to review the results.' : 'No records need review for this check.'}</p>}</div>
      </BulkSelection>
      <nav aria-label="Issue results pages" className="mt-3 flex flex-wrap items-center gap-3 text-sm"><span>{result.count ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, result.count)}` : '0'} of {result.count}</span><span>Page {Math.min(page, pages)} of {pages}</span>{page > 1 && <Link className="btn-secondary" href={href(selected.key, q, page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={href(selected.key, q, page + 1)}>Next</Link>}</nav>
    </section>}
  </Content>;
}
