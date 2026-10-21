import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { caseHistoryOptions, caseNoteForReading } from '@/lib/support-case-history';
import { supportUserZone } from '@/lib/support-case-ui';
import { formatDateTimeForUser } from '@/lib/display-format';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';

export const dynamic = 'force-dynamic';
export default async function CaseNotePage({ params, searchParams }: {
  params: Promise<{ id: string; noteId: string }>; searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const actor = await requirePermission('support-cases.read');
  const { id: rawId, noteId: rawNoteId } = await params;
  const id = Number(rawId), noteId = Number(rawNoteId);
  const [note, zone] = await Promise.all([caseNoteForReading(prisma, actor, id, noteId), supportUserZone(actor)]);
  if (!note?.supportCase) notFound();
  const options = caseHistoryOptions(await searchParams);
  const historyHref = `/support/cases/${id}/history?${new URLSearchParams({ page: String(options.page), type: options.type })}`;
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.support} title="Case Note" description={`${note.supportCase.caseNumber} · ${note.supportCase.subject}`}
    action={<div className="page-header-actions"><Link className="btn-secondary" href={historyHref}>Back to history</Link><Link className="btn-secondary" href={`/support/cases/${id}`}>Back to Case</Link></div>}/>
    <article className="panel min-w-0 p-5 sm:p-6" aria-label="Full Note">
      <p className="mb-4 text-sm text-slate-500">{formatDateTimeForUser(note.createdAt, zone)}{note.createdBy && ` · ${note.createdBy.firstName} ${note.createdBy.lastName}`}</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{note.body}</p>
    </article>
  </Content>;
}
