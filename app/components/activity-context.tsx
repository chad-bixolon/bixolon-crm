import Link from 'next/link';
import { can, type Actor } from '@/lib/authorization';

export type ActivityContextData = {
  account: { id: number; name: string } | null;
  opportunity: { id: number; name: string } | null;
  project: { id: number; name: string } | null;
  supportCase: { id: number; caseNumber: string } | null;
  calendarReview?: { eventId: number } | null;
};

export function ActivityContext({ row, actor }: { row: ActivityContextData; actor: Actor }) {
  const links = [
    ...(row.account ? [{ label: 'Account', name: row.account.name, href: `/accounts/${row.account.id}` }] : []),
    ...(row.opportunity && can(actor, 'opportunities.read') ? [{ label: 'Opportunity', name: row.opportunity.name, href: `/opportunities/${row.opportunity.id}` }] : []),
    ...(row.project && can(actor, 'projects.read') ? [{ label: 'Project', name: row.project.name, href: `/projects/${row.project.id}` }] : []),
    ...(row.supportCase && can(actor, 'support-cases.read') ? [{ label: 'Support Case', name: row.supportCase.caseNumber, href: `/support/cases/${row.supportCase.id}` }] : []),
  ];
  return <div className="space-y-1 text-sm">{links.map(link => <p key={link.href} className="break-words">{link.label}: <Link className="text-orange-800 underline" href={link.href}>{link.name}</Link></p>)}{row.calendarReview && <p className="text-slate-600">Source: Calendar-linked meeting</p>}</div>;
}
