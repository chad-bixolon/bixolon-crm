import { MultiCurrencyOnly } from '@/components/currency-control';
import { companyCurrency } from '@/lib/company-currency';
import { CurrencyControl } from '@/components/currency-control';
import { snapshotAttribution } from '@/lib/snapshot-capture-identity';
import { HelpLink } from '@/components/help-link';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Prisma, type SalesQuarter } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { canReadOpportunitySnapshots } from '@/lib/opportunity-snapshots';
import { compareForecastSnapshotRuns, summarizeForecastRows } from '@/lib/forecast-snapshots';
import { businessQuarter, quarters } from '@/lib/business-quarter';
import { formatPlanCurrency as formatCurrency } from '@/lib/display-format';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
type Params = Record<string, string | string[] | undefined>;
const scalar = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const id = (value: string | string[] | undefined) => { const n = Number(scalar(value)); return Number.isSafeInteger(n) && n > 0 ? n : undefined; };
function date(value: string | string[] | undefined) {
  const raw = scalar(value); if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const at = new Date(`${raw}T00:00:00Z`); return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === raw ? at : undefined;
}
export default async function ForecastSnapshotsReport({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await currentUser(); if (!canReadOpportunitySnapshots(actor)) notFound();
  const currencyConfig = await companyCurrency();
  const params = await searchParams, current = businessQuarter();
  const yearParam = Number(scalar(params.year)), quarterParam = scalar(params.quarter) as SalesQuarter;
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100 ? yearParam : current.year;
  const quarter = quarters.includes(quarterParam) ? quarterParam : current.quarter;
  const from = date(params.from), through = date(params.through), ownerId = id(params.ownerId);
  const currencyCode = /^[A-Z]{3}$/.test(scalar(params.currencyCode) ?? '') ? scalar(params.currencyCode) : undefined;
  const runs = await prisma.forecastSnapshotRun.findMany({ where: { year, quarter, snapshotAt: { ...(from ? { gte: from } : {}), ...(through ? { lt: new Date(through.getTime() + 86400000) } : {}) } }, orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 104 });
  const beforeId = id(params.before) ?? runs[1]?.id, afterId = id(params.after) ?? runs[0]?.id;
  const extraIds = [beforeId, afterId].filter((key): key is number => !!key && !runs.some(run => run.id === key));
  const extraRuns = extraIds.length ? await prisma.forecastSnapshotRun.findMany({ where: { id: { in: extraIds }, year, quarter }, take: 2 }) : [];
  const choices = [...runs, ...extraRuns];
  const [owners, capturedCurrencies] = await Promise.all([
    prisma.$queryRaw<{ id: number; name: string }[]>(Prisma.sql`SELECT r."ownerId" AS id, (array_agg(r."ownerName" ORDER BY f."snapshotAt" DESC, f.id DESC))[1] AS name FROM "ForecastSnapshotRollup" r JOIN "ForecastSnapshotRun" f ON f.id = r."runId" WHERE f.year = ${year} AND f.quarter = ${quarter}::"SalesQuarter" GROUP BY r."ownerId" ORDER BY name LIMIT 201`),
    prisma.forecastSnapshotRollup.groupBy({ by: ['currencyCode'], where: { run: { year, quarter } }, orderBy: { currencyCode: 'asc' } }),
  ]);
  const currencies = [...new Set([...currencyConfig.activeCurrencies.map(row => row.code), ...capturedCurrencies.map(row => row.currencyCode)])].sort().map(currencyCode => ({currencyCode}));
  let result: Awaited<ReturnType<typeof compareForecastSnapshotRuns>> | undefined, error = '';
  if (beforeId && afterId) {
    try {
      result = await compareForecastSnapshotRuns(prisma, actor, beforeId, afterId, { ownerId, currencyCode });
      if (result.before.year !== year || result.before.quarter !== quarter) { result = undefined; error = 'Choose snapshots for the selected forecast period.'; }
    } catch (failure) { if (failure instanceof Error && /^Choose /.test(failure.message)) error = failure.message; else throw failure; }
  }
  const historyRuns = runs.slice(0, 8);
  const historyRows = ownerId && historyRuns.length ? await prisma.forecastSnapshotRollup.groupBy({
    by: ['runId', 'currencyCode', 'forecastCategory'], where: { runId: { in: historyRuns.map(run => run.id) }, ownerId, ...(currencyCode ? { currencyCode } : {}) }, _sum: { amount: true, opportunityCount: true },
  }) : [];
  const page = Math.max(1, Math.min(10000, id(params.page) ?? 1));
  const teamGroups = result?.groups.filter(group => group.ownerId === undefined) ?? [];
  const repGroups = result?.groups.filter(group => group.ownerId !== undefined) ?? [];
  const shown = [...teamGroups, ...repGroups.slice((page - 1) * 25, page * 25)];
  const pageHref = (next: number) => {
    const q = new URLSearchParams({ year: String(year), quarter, page: String(next) });
    for (const key of ['before', 'after', 'ownerId', 'currencyCode', 'from', 'through']) if (scalar(params[key])) q.set(key, scalar(params[key])!);
    if (beforeId) q.set('before', String(beforeId)); if (afterId) q.set('after', String(afterId));
    return `/reports/forecast-snapshots?${q}`;
  };
  const drillHref = (group: typeof shown[number], metric: string) => {
    const q = new URLSearchParams({ before: String(result!.before.sourceRunId), after: String(result!.after.sourceRunId), year: String(year), quarter, currencyCode: group.currencyCode });
    if (group.ownerId ?? ownerId) q.set('ownerId', String(group.ownerId ?? ownerId));
    const category = ({ pipeline: 'ALL_OPEN', bestCase: 'BEST_CASE', commit: 'COMMIT', closedWon: 'CLOSED' } as Record<string, string>)[metric];
    if (category) q.set('category', category);
    return `/reports/opportunity-snapshots?${q}`;
  };
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.reports} title="Forecast Snapshot History" description="Compare quarterly forecasts from Opportunity Snapshots captured at a point in time. Forecast Movement uses separate weekly captures." action={actor.role === 'ADMIN' ? <Link className="btn-secondary" href="/administration/forecast-snapshots">Create Forecast Snapshot</Link> : <Link className="btn-secondary" href="/reports">Reports</Link>}/><div className="mb-4"><HelpLink topic="forecast-snapshots">Help with Forecast Snapshots</HelpLink></div>
    <form className="panel mb-5 grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm">Forecast year<input className="field mt-1" type="number" min="2000" max="2100" name="year" defaultValue={year}/></label>
      <label className="text-sm">Forecast quarter<select className="field mt-1" name="quarter" aria-label="Forecast quarter" defaultValue={quarter}>{quarters.map(q => <option key={q}>{q}</option>)}</select></label>
      {([['before', 'Earlier Forecast Snapshot', beforeId], ['after', 'Later Forecast Snapshot', afterId]] as const).map(([name, label, selected]) => <label className="min-w-0 text-sm" key={name}>{label}<select className="field mt-1 w-full" name={name} aria-label={label} defaultValue={selected ?? ''}><option value="">Choose a snapshot</option>{choices.map(run => <option value={run.id} key={run.id}>#{run.id} · {run.snapshotAt.toISOString()} · Opportunity Snapshot #{run.sourceRunId} · {snapshotAttribution(run)}</option>)}</select></label>)}
      <label className="min-w-0 text-sm">Salesperson<select className="field mt-1 w-full" name="ownerId" aria-label="Salesperson" defaultValue={ownerId ?? ''}><option value="">All salespeople</option>{owners.map(owner => <option value={owner.id} key={owner.id}>{owner.name}</option>)}</select></label>
      <CurrencyControl name="currencyCode" value={currencyCode ?? ''} historicalCodes={currencies.map(row => row.currencyCode)}><label className="text-sm">Currency<select className="field mt-1" name="currencyCode" aria-label="Currency" defaultValue={currencyCode ?? ''}><option value="">All (separate totals)</option>{currencies.map(row => <option key={row.currencyCode}>{row.currencyCode}</option>)}</select></label></CurrencyControl>
      <label className="text-sm">Snapshot date from (UTC)<input className="field mt-1" type="date" name="from" defaultValue={from?.toISOString().slice(0, 10)}/></label>
      <label className="text-sm">Snapshot date through (UTC)<input className="field mt-1" type="date" name="through" defaultValue={through?.toISOString().slice(0, 10)}/></label>
      <div className="compact-action-row flex items-center gap-4"><button className="btn-primary">Compare forecasts</button><Link className="text-sm underline" href="/reports/forecast-snapshots">Reset</Link></div>
    </form>
    <p className="panel mb-5 p-4 text-sm">Pipeline includes Best Case and Commit<MultiCurrencyOnly>; currencies stay separate</MultiCurrencyOnly>. Closed Won uses the captured won stage and Expected Close Date in {year} {quarter}, rather than an actual booking date.</p>
    <p className="mb-4 text-sm text-slate-600">Up to 104 snapshots are shown for the selected dates (UTC). Use the period and date filters for older history.{owners.length > 200 && ' The salesperson list shows up to 201 names recorded in snapshots.'}</p>
    {error && <p role="alert" className="panel mb-5 p-4 text-red-700">{error}</p>}
    {!result && !error && <p className="panel mb-5 p-5">{runs.length < 2 ? 'Create two Forecast Snapshots from different Opportunity capture dates for this period to compare. History begins with the first capture.' : 'Choose two Forecast Snapshots.'}</p>}
    {result && <>
      <p className="mb-4 break-words text-sm">Earlier #{result.before.id}: {result.before.snapshotAt.toISOString()} · Opportunity Snapshot #{result.before.sourceRunId}. Later #{result.after.id}: {result.after.snapshotAt.toISOString()} · Opportunity Snapshot #{result.after.sourceRunId}.</p>
      <section className="panel min-w-0 overflow-x-auto" aria-label="Forecast comparison"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr>{['Salesperson / Currency', 'Metric', 'Previous', 'Current', 'Change', 'Change %', 'Details'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{shown.flatMap(group => group.metrics.map(metric => <tr className="border-t align-top" key={`${group.ownerId ?? 'team'}-${group.currencyCode}-${metric.key}`}><td className="max-w-52 break-words p-3">{group.ownerName} · {group.currencyCode}{group.previousOwnerName && group.previousOwnerName !== group.ownerName && <span className="block text-xs text-slate-500">Previously {group.previousOwnerName}</span>}</td><td className="p-3">{metric.label}</td>{(['previous', 'current', 'change'] as const).map(key => <td className="whitespace-nowrap p-3" key={key}>{metric.key === 'opportunityCount' ? Number(metric[key]) : formatCurrency(metric[key], group.currencyCode)}</td>)}<td className="p-3">{metric.percent === null ? '— (previous value is zero)' : `${metric.percent}%`}</td><td className="p-3">{new Prisma.Decimal(metric.change).isZero() ? <Link className="text-orange-800 underline" href={drillHref(group, metric.key)}>View Opportunities</Link> : <Link className="font-semibold text-orange-800 underline" href={drillHref(group, metric.key)}>Explain movement</Link>}</td></tr>))}</tbody></table>{!shown.length && <p className="p-5 text-sm">No matching forecast values. An empty snapshot has no eligible Opportunities.</p>}</section>
      <nav className="my-4 flex gap-4 text-sm" aria-label="Forecast comparison pages">{page > 1 && <Link className="underline" href={pageHref(page - 1)}>Previous</Link>}<span>Page {page} · up to 25 salesperson/currency groups</span>{repGroups.length > page * 25 && <Link className="underline" href={pageHref(page + 1)}>Next</Link>}</nav>
    </>}
    <section className="panel mt-5 p-5" aria-labelledby="rep-history-title"><h2 id="rep-history-title" className="mb-3 font-semibold">Forecast History{ownerId ? ` — ${owners.find(owner => owner.id === ownerId)?.name ?? `Salesperson #${ownerId}`}` : ''}</h2>
      {!ownerId ? <p className="text-sm">Select a salesperson to see their latest eight forecasts for this period.</p> : historyRuns.map(run => {
        const selected = historyRows.filter(row => row.runId === run.id);
        const codes = currencyCode ? [currencyCode] : [...new Set(selected.map(row => row.currencyCode))].sort();
        return <div key={run.id} className="border-t py-3 text-sm"><p className="break-words font-medium">{run.snapshotAt.toISOString()} · #{run.id}</p>{codes.map(code => {
          const totals = summarizeForecastRows(selected.filter(row => row.currencyCode === code).map(row => ({ forecastCategory: row.forecastCategory, amount: row._sum.amount ?? new Prisma.Decimal(0), opportunityCount: row._sum.opportunityCount ?? 0 })));
          return <p className="mt-1 leading-6" key={code}>{code} · Commit {formatCurrency(totals.commit, code)} · Best Case {formatCurrency(totals.bestCase, code)} · Pipeline {formatCurrency(totals.pipeline, code)} · Closed Won {formatCurrency(totals.closedWon, code)}</p>;
        })}{!codes.length && <p>No included Opportunities for this salesperson.</p>}</div>;
      })}
    </section>
  </Content>;
}
