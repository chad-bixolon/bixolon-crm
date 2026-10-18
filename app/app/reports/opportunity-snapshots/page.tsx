import { MultiCurrencyOnly } from '@/components/currency-control';
import { snapshotAttribution } from '@/lib/snapshot-capture-identity';
import { HelpLink } from '@/components/help-link';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { OpportunitySnapshot } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { canReadOpportunitySnapshots, compareSnapshotRuns, snapshotAccounts } from '@/lib/opportunity-snapshots';
import { formatCurrency } from '@/lib/display-format';
import { quarters } from '@/lib/business-quarter';
import type { SalesQuarter } from '@prisma/client';
import { forecastLabels } from '@/lib/crm-validation';

export const dynamic = 'force-dynamic';
type Params = Record<string, string | string[] | undefined>;
const scalar = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const idParam = (value: string | string[] | undefined) => { const n = Number(scalar(value)); return Number.isSafeInteger(n) && n > 0 ? n : undefined; };
function dateParam(value: string | string[] | undefined) {
  const raw = scalar(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? date : undefined;
}
function SnapshotValues({ row }: { row: OpportunitySnapshot | null }) {
  if (!row) return <span className="text-slate-500">Not included in this snapshot</span>;
  return <dl className="space-y-1">
    <div><dt className="inline text-slate-500">Status: </dt><dd className="inline">{row.status}</dd></div>
    <div><dt className="inline text-slate-500">Stage: </dt><dd className="inline">{row.stageName}</dd></div>
    <div><dt className="inline text-slate-500">Value: </dt><dd className="inline">{formatCurrency(row.amount, row.currencyCode)} {row.currencyCode}</dd></div>
    <div><dt className="inline text-slate-500">Expected close: </dt><dd className="inline">{row.expectedCloseDate?.toISOString().slice(0, 10) ?? '—'}</dd></div>
    <div><dt className="inline text-slate-500">Owner: </dt><dd className="inline">{row.ownerName ?? 'Unassigned'}</dd></div>
    {row.ownerForecastEligible != null && <div><dt className="inline text-slate-500">Forecast owner: </dt><dd className="inline">{row.ownerForecastEligible ? 'Eligible at capture' : 'Ineligible at capture'}</dd></div>}
    <div><dt className="inline text-slate-500">Forecast: </dt><dd className="inline">{forecastLabels[row.forecastCategory]}</dd></div>
    <div><dt className="inline text-slate-500">Probability: </dt><dd className="inline">{row.probability}%</dd></div>
    <div><dt className="inline text-slate-500">Accounts: </dt><dd className="inline">{snapshotAccounts(row.accounts).map(a => a.name).join(' · ') || 'None'}</dd></div>
  </dl>;
}

export default async function OpportunitySnapshotsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await currentUser();
  if (!canReadOpportunitySnapshots(actor)) notFound();
  const params = await searchParams;
  const from = dateParam(params.from), through = dateParam(params.through);
  const runs = await prisma.opportunitySnapshotRun.findMany({
    where: { snapshotAt: { ...(from ? { gte: from } : {}), ...(through ? { lt: new Date(through.getTime() + 86400000) } : {}) } },
    orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 104,
  });
  const beforeId = idParam(params.before) ?? runs[1]?.id, afterId = idParam(params.after) ?? runs[0]?.id;
  // Selected runs may be outside the date-window picker, so keep their labels available.
  const extraIds = [beforeId, afterId].filter((id): id is number => !!id && !runs.some(run => run.id === id));
  const extraRuns = extraIds.length ? await prisma.opportunitySnapshotRun.findMany({ where: { id: { in: extraIds } }, take: 2 }) : [];
  const options = [...runs, ...extraRuns];
  const year = Number(scalar(params.year)), quarter = scalar(params.quarter) as SalesQuarter;
  const forecastPeriod = Number.isInteger(year) && year >= 2000 && year <= 2100 && quarters.includes(quarter) ? { year, quarter } : undefined;
  const filters = { forecastPeriod, currencyCode: scalar(params.currencyCode), category: scalar(params.category), ownerId: idParam(params.ownerId), stageId: idParam(params.stageId), accountId: idParam(params.accountId), opportunityId: idParam(params.opportunityId), page: idParam(params.page) };
  const selectedRuns = [beforeId, afterId].filter((id): id is number => !!id);
  const [owners, stages, accounts] = selectedRuns.length ? await Promise.all([
    prisma.$queryRaw<{ id: number; name: string }[]>(Prisma.sql`SELECT "ownerId" AS id, min("ownerName") AS name FROM "OpportunitySnapshot" WHERE "runId" IN (${Prisma.join(selectedRuns)}) AND "ownerId" IS NOT NULL GROUP BY "ownerId" ORDER BY name LIMIT 201`),
    prisma.$queryRaw<{ id: number; name: string }[]>(Prisma.sql`SELECT "stageId" AS id, min("stageName") AS name FROM "OpportunitySnapshot" WHERE "runId" IN (${Prisma.join(selectedRuns)}) GROUP BY "stageId" ORDER BY name LIMIT 201`),
    prisma.$queryRaw<{ id: number; name: string }[]>(Prisma.sql`SELECT (a->>'id')::integer AS id, min(a->>'name') AS name FROM "OpportunitySnapshot", jsonb_array_elements(accounts) a WHERE "runId" IN (${Prisma.join(selectedRuns)}) GROUP BY (a->>'id')::integer ORDER BY name LIMIT 201`),
  ]) : [[], [], []];
  let result: Awaited<ReturnType<typeof compareSnapshotRuns>> | undefined, error = '';
  if (beforeId && afterId) {
    try { result = await compareSnapshotRuns(prisma, actor, beforeId, afterId, filters); }
    catch (failure) {
      if (failure instanceof Error && /^Choose /.test(failure.message)) error = failure.message;
      else throw failure;
    }
  }
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (key !== 'page' && scalar(value)) query.set(key, scalar(value)!);
    if (beforeId) query.set('before', String(beforeId)); if (afterId) query.set('after', String(afterId));
    query.set('page', String(page)); return `/reports/opportunity-snapshots?${query}`;
  };
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.reports} title="Opportunity Snapshot History" description="Compare Opportunity history using names and values preserved at each capture." action={actor.role === 'ADMIN' ? <Link className="btn-secondary" href="/administration/opportunity-snapshots">Capture snapshot</Link> : <Link className="btn-secondary" href="/reports">Reports</Link>}/><div className="mb-4"><HelpLink topic="opportunity-snapshots">Help with Opportunity Snapshots</HelpLink></div>
    <form className="panel mb-5 grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm">Snapshot date from (UTC)<input className="field mt-1" type="date" name="from" defaultValue={from?.toISOString().slice(0, 10)}/></label>
      <label className="text-sm">Snapshot date through (UTC)<input className="field mt-1" type="date" name="through" defaultValue={through?.toISOString().slice(0, 10)}/></label>
      {([['before', 'Earlier snapshot', beforeId], ['after', 'Later snapshot', afterId]] as const).map(([name, label, selected]) => <label className="min-w-0 text-sm" key={name}>{label}<select className="field mt-1 w-full" name={name} defaultValue={selected ?? ''}><option value="">Choose a snapshot</option>{options.map(run => <option key={run.id} value={run.id}>#{run.id} · {run.snapshotAt.toISOString()} · {run.opportunityCount} Opportunities · {snapshotAttribution(run)}</option>)}</select></label>)}
      {([['ownerId', 'Salesperson', owners], ['stageId', 'Stage', stages], ['accountId', 'Account', accounts]] as const).map(([name, label, values]) => <label className="min-w-0 text-sm" key={name}>{label}<select className="field mt-1 w-full" name={name} defaultValue={scalar(params[name]) ?? ''}><option value="">All</option>{values.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>)}
      {forecastPeriod && <><input type="hidden" name="year" value={forecastPeriod.year}/><input type="hidden" name="quarter" value={forecastPeriod.quarter}/></>}
      {filters.currencyCode && <input type="hidden" name="currencyCode" value={filters.currencyCode}/>}
      {filters.category && <input type="hidden" name="category" value={filters.category}/>}
      {filters.opportunityId && <input type="hidden" name="opportunityId" value={filters.opportunityId}/>}
      <div className="compact-action-row flex flex-wrap items-end gap-3"><button className="btn-primary">Compare snapshots</button><Link className="text-sm text-orange-800 underline" href="/reports/opportunity-snapshots">Reset</Link></div>
    </form>
    <p className="mb-4 text-sm text-slate-600">Filters can match either snapshot; both captured values stay visible. The list shows up to 50 Opportunities per page and 104 snapshots for the selected dates (UTC). {Math.max(owners.length, stages.length, accounts.length) > 200 && 'Filter choices are limited to the first 201 historical names.'}</p>
    {forecastPeriod && <p className="panel mb-5 p-4 text-sm">Opportunities behind the forecast: {forecastPeriod.year} {forecastPeriod.quarter} · {filters.currencyCode ?? 'all currencies'} · {filters.category ?? 'open + won'}. Matches can come from either snapshot, and both captured values stay visible. Pipeline includes Best Case and Commit. <Link className="underline" href={`/reports/forecast-snapshots?year=${forecastPeriod.year}&quarter=${forecastPeriod.quarter}`}>Forecast Snapshot History</Link></p>}
    <p className="panel mb-5 p-4 text-sm">Each snapshot keeps open deals, or open and Closed Won deals when forecast data is included. A deal appearing or disappearing doesn’t establish a win or loss; check its changes and customer relationships for context.</p>
    {error && <p className="panel mb-5 p-4 text-red-700" role="alert">{error}</p>}
    {!result && !error && <p className="panel p-5">{runs.length < 2 ? 'Capture snapshots in two different weeks to compare Opportunity history. Snapshots cannot reconstruct dates before the first capture.' : 'Choose two snapshots to compare.'}</p>}
    {result && <>
      <section className="panel mb-5 p-5"><h2 className="mb-3 font-semibold">{forecastPeriod ? 'Underlying Opportunity values at each snapshot' : 'Pipeline at each snapshot'}</h2><p className="mb-3 text-sm text-slate-600">Totals include Opportunities matching either snapshot across all pages<MultiCurrencyOnly>, separately by currency</MultiCurrencyOnly>. {forecastPeriod && 'Both captured values count even if one is outside the forecast filters, so these totals may differ from the forecast.'}</p><ul className="space-y-2 text-sm">{result.totals.map(total => <li key={`${total.runId}-${total.currencyCode}`}>Snapshot #{total.runId} · {total.currencyCode} · {String(total.count)} Opportunities · {formatCurrency(total.amount, total.currencyCode)}</li>)}</ul>{!result.totals.length && <p className="text-sm">No matching Opportunities.</p>}</section>
      <section className="panel min-w-0 overflow-x-auto" aria-label="Snapshot comparison"><table className="w-full min-w-[860px] table-fixed text-left text-sm"><thead className="border-b bg-slate-50"><tr><th className="w-[20%] p-4">Opportunity</th><th className="w-[24%] p-4">Movement</th><th className="w-[28%] p-4">Earlier · #{result.before.id}<span className="block text-xs font-normal">{result.before.snapshotAt.toISOString()}</span></th><th className="w-[28%] p-4">Later · #{result.after.id}<span className="block text-xs font-normal">{result.after.snapshotAt.toISOString()}</span></th></tr></thead><tbody className="divide-y">{result.rows.map(row => <tr className="align-top" key={row.opportunityId}><td className="break-words p-4"><Link className="text-orange-800 underline" href={`/opportunities/${row.opportunityId}`}>{row.after?.opportunityName ?? row.before?.opportunityName}</Link></td><td className="p-4"><ul className="space-y-2">{row.changes.map(change => <li key={change}>{change}</li>)}</ul></td><td className="break-words p-4"><SnapshotValues row={row.before}/></td><td className="break-words p-4"><SnapshotValues row={row.after}/></td></tr>)}</tbody></table>{!result.rows.length && <p className="p-5 text-sm">No matching Opportunities.</p>}</section>
      <nav className="mt-4 flex gap-4 text-sm" aria-label="Snapshot report pages">{result.page > 1 && <Link className="text-orange-800 underline" href={pageHref(result.page - 1)}>Previous</Link>}<span>Page {result.page}</span>{result.hasMore && <Link className="text-orange-800 underline" href={pageHref(result.page + 1)}>Next</Link>}</nav>
    </>}
  </Content>;
}
