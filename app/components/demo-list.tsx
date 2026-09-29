import Link from 'next/link';
import { demoLabel } from '@/lib/demos';
import { demoDisplayDate, demoStatusLabel } from '@/lib/demo-display';
import { demoSummary, opportunityResult, type UnitState } from '@/lib/demo-operations';

type DemoRow = {
  id: number; sourceRequestId: string | null; demoNumber: string | null; status: string; requestedAt: Date;
  requestedBy: { firstName: string; lastName: string } | null;
  durationValue: number | null; durationUnit: string | null; shippedAt: Date | null; expectedReturnOverrideAt: Date | null;
  items: { sourceSku: string; quantity: number; retiredAt: Date | null; units: UnitState[]; productSku: { product: { name: string }; partNumber: string } | null }[];
  project: { id: number; name: string; status: string; archivedAt: Date | null } | null;
  opportunity: { id: number; name: string; stage: { isClosed: boolean; isWon: boolean } } | null;
};
export const demoListInclude = {
  requestedBy: { select: { firstName: true, lastName: true } },
  items: { include: { units: { orderBy: { ordinal: 'asc' } }, productSku: { select: { partNumber: true, product: { select: { name: true } } } } }, orderBy: { id: 'asc' } },
  project: { select: { id: true, name: true, status: true, archivedAt: true } },
  opportunity: { select: { id: true, name: true, stage: { select: { isClosed: true, isWon: true } } } },
} as const;
export function DemoList({ rows, empty = 'No demos have been recorded for this Account.' }: { rows: DemoRow[]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return <div className="max-w-full overflow-x-auto overscroll-x-contain"><table className="w-full min-w-[1100px] table-fixed text-left text-sm"><colgroup><col className="w-[130px]"/><col className="w-[130px]"/><col/><col className="w-[80px]"/><col className="w-[100px]"/><col className="w-[80px]"/><col className="w-[100px]"/><col className="w-[125px]"/><col className="w-[170px]"/></colgroup><thead className="border-b text-xs uppercase text-slate-500"><tr>{['Demo','Status','Product / SKU','Deployed','Outstanding','Returned','Shipped','Expected return','Business context'].map(label => <th key={label} className="whitespace-nowrap px-2.5 py-2">{label}</th>)}</tr></thead><tbody className="divide-y">{rows.map(row => { const summary = demoSummary(row); const first = row.items.find(item => !item.retiredAt) ?? row.items[0]; return <tr key={row.id}><td className="whitespace-nowrap px-2.5 py-3"><Link className="font-medium text-orange-800 underline" href={`/demos/${row.id}`}>{demoLabel(row)}</Link></td><td className="px-2.5 py-3">{demoStatusLabel(row.status)}<span className="block text-xs text-slate-500">Requested {summary.total} · {row.requestedBy ? `${row.requestedBy.firstName} ${row.requestedBy.lastName}` : '—'}</span>{summary.overdue && <span className="block text-amber-800">Overdue</span>}{summary.recoveryAttention && <span className="block text-amber-800">Return attention</span>}{summary.deployed > 0 && !summary.outstanding && <span className="block">Returned</span>}</td><td className="break-words px-2.5 py-3">{first ? <>{first.productSku?.product.name ?? first.sourceSku}{first.productSku?.product.name !== (first.productSku?.partNumber ?? first.sourceSku) && <span className="block text-xs text-slate-500">{first.productSku?.partNumber ?? first.sourceSku}</span>}{row.items.length > 1 && <span className="block text-xs text-slate-500">+${row.items.length - 1} more</span>}</> : '—'}</td><td className="px-2.5 py-3 tabular-nums">{summary.deployed}</td><td className="px-2.5 py-3 tabular-nums">{summary.outstanding}</td><td className="px-2.5 py-3 tabular-nums">{summary.returned}</td><td className="whitespace-nowrap px-2.5 py-3">{row.shippedAt ? demoDisplayDate(row.shippedAt) : '—'}</td><td className="whitespace-nowrap px-2.5 py-3">{summary.expected ? demoDisplayDate(summary.expected) : '—'}</td><td className="break-words px-2.5 py-3">{row.project && <Link className="block text-orange-800" href={`/projects/${row.project.id}`}>{row.project.name} · {row.project.status}</Link>}{row.opportunity && <Link className="block text-orange-800" href={`/opportunities/${row.opportunity.id}`}>{row.opportunity.name} · {opportunityResult(row.opportunity)}</Link>}{!row.project && !row.opportunity && <span className="text-slate-500">Account only</span>}</td></tr>; })}</tbody></table></div>;
}
