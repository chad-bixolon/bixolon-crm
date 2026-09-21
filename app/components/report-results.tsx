'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { formatCurrency } from '@/lib/display-format';
import type { PipelineReportResult, ReportConfiguration } from '@/lib/reporting';

const metricLabel: Record<string, string> = { pipeline: 'Pipeline', weightedPipeline: 'Weighted Pipeline', opportunityCount: 'Opportunities', averageOpportunityValue: 'Average Opportunity Value' };
const columnLabel: Record<string, string> = { opportunity: 'Opportunity', account: 'Account', owner: 'Owner', stage: 'Stage', closeDate: 'Close Date', value: 'Value', weightedValue: 'Weighted Value', currency: 'Currency' };
const cellSpacing = 'px-2.5 py-2';
const columnClass: Record<string, string> = {
  opportunity: 'max-w-52', account: 'max-w-48', owner: 'max-w-32', stage: 'max-w-32',
  closeDate: 'min-w-24 whitespace-nowrap', value: 'min-w-28 whitespace-nowrap text-right tabular-nums',
  weightedValue: 'min-w-40 whitespace-nowrap text-right tabular-nums', currency: 'min-w-16 whitespace-nowrap',
};

function TruncatedText({ value, maxWidth = 'max-w-48', children }: { value: string; maxWidth?: string; children?: ReactNode }) {
  return <span className={`block truncate focus-within:outline-2 focus-within:outline-orange-600 ${maxWidth}`} title={value}>{children ?? value}</span>;
}

function ResultTableScroll({ label, children }: { label: string; children: ReactNode }) {
  return <>
    <p className="px-4 pb-2 text-xs text-slate-500 xl:hidden">Scroll horizontally to see all columns.</p>
    <div role="region" aria-label={`${label} table, scroll horizontally for more columns`} tabIndex={0} className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-orange-600">
      {children}
    </div>
  </>;
}

export function ReportResults({ result, config, groupKey }: { result: PipelineReportResult; config: ReportConfiguration; groupKey?: string }) {
  const pathname = usePathname(), searchParams = useSearchParams();
  const groupHref = (key?: string) => { const query = new URLSearchParams(searchParams.toString()); if (key) query.set('group', key); else query.delete('group'); return `${pathname}?${query}`; };
  const detail = groupKey ? result.rows.filter(row => row.groupKeys.includes(groupKey)) : result.rows;
  return <div className="mt-6 min-w-0 max-w-full space-y-5">
    <p className="text-sm text-slate-600">{result.semanticNote}</p>
    <section><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Summary</h2>{result.currencies.length > 1 && <p className="text-xs text-slate-600">Totals are shown separately by currency.</p>}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{result.summary.flatMap(summary => config.metrics.map(metric => <div className="panel min-w-0 p-4" key={`${summary.currency}-${metric}`}><p className="text-xs uppercase tracking-wide text-slate-500">{metricLabel[metric]}{metric === 'opportunityCount' ? '' : ` · ${summary.currency}`}</p><p className="mt-2 break-words text-xl font-semibold tabular-nums sm:text-2xl">{metric === 'opportunityCount' ? summary.opportunityCount : formatCurrency(Number(summary[metric as 'pipeline'|'weightedPipeline'|'averageOpportunityValue']), summary.currency, result.currencies.length > 1)}</p></div>))}</div></section>
    {!!result.groups.length && <section className="panel min-w-0 max-w-full"><h2 className="p-4 text-lg font-semibold">Grouped results</h2><ResultTableScroll label="Grouped results"><table className="w-full min-w-max text-sm"><thead className="bg-slate-50"><tr><th scope="col" className={`${cellSpacing} max-w-52 text-left`}>Group</th><th scope="col" className={`${cellSpacing} min-w-16 text-left`}>Currency</th>{config.metrics.map(metric => <th scope="col" className={`${cellSpacing} min-w-28 whitespace-nowrap text-right`} key={metric}>{metricLabel[metric]}</th>)}</tr></thead><tbody className="divide-y">{result.groups.flatMap(group => group.metrics.map((summary, index) => <tr key={`${group.key}-${summary.currency}`}><td className={`${cellSpacing} max-w-52`}>{index === 0 ? <TruncatedText value={group.label} maxWidth="max-w-52"><Link className="text-orange-800 underline focus-visible:outline-2 focus-visible:outline-orange-600" href={groupHref(group.key)}>{group.label}</Link></TruncatedText> : ''}</td><td className={`${cellSpacing} whitespace-nowrap`}>{summary.currency}</td>{config.metrics.map(metric => <td className={`${cellSpacing} whitespace-nowrap text-right tabular-nums`} key={metric}>{metric === 'opportunityCount' ? summary.opportunityCount : formatCurrency(Number(summary[metric as 'pipeline'|'weightedPipeline'|'averageOpportunityValue']), summary.currency, true)}</td>)}</tr>))}</tbody></table></ResultTableScroll></section>}
    <section className="panel min-w-0 max-w-full"><div className="flex flex-wrap items-center justify-between gap-2 p-4"><h2 className="text-lg font-semibold">{groupKey ? 'Drill-down' : 'Details'} ({detail.length})</h2>{groupKey && <Link className="btn-secondary" href={groupHref()}>Clear drill-down</Link>}</div><ResultTableScroll label="Details"><table className="w-full min-w-max text-sm"><thead className="bg-slate-50"><tr>{config.columns.map(column => <th scope="col" className={`${cellSpacing} ${columnClass[column]} ${['value', 'weightedValue'].includes(column) ? '' : 'text-left'}`} key={column}>{columnLabel[column]}</th>)}</tr></thead><tbody className="divide-y">{detail.map(row => <tr key={row.id}>{config.columns.map(column => <td className={`${cellSpacing} ${columnClass[column]}`} key={column}>{column === 'opportunity' ? <TruncatedText value={row.opportunity} maxWidth="max-w-52"><Link className="text-orange-800 underline focus-visible:outline-2 focus-visible:outline-orange-600" href={`/opportunities/${row.id}`}>{row.opportunity}</Link></TruncatedText> : column === 'account' ? <TruncatedText value={row.accounts} /> : column === 'owner' ? <TruncatedText value={row.owner} maxWidth="max-w-32" /> : column === 'stage' ? <TruncatedText value={row.stage} maxWidth="max-w-32" /> : column === 'closeDate' ? row.closeDate ?? '—' : column === 'value' ? formatCurrency(Number(row.value), row.currency) : column === 'weightedValue' ? `${formatCurrency(Number(row.weightedValue), row.currency)} (${row.probability}%)` : row.currency}</td>)}</tr>)}</tbody></table></ResultTableScroll>{!detail.length && <p className="p-4 text-sm text-slate-500">No Opportunities match this report.</p>}</section>
  </div>;
}
