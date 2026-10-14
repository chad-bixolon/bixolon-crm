import Link from 'next/link';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { supportUserZone } from '@/lib/support-case-ui';
import { caseEmailFileContext } from '@/lib/support-email-file-import';
import { CaseEmailFilesForm } from './form';
export const dynamic = 'force-dynamic';
export default async function CaseEmailFilesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ before?: string; retryPage?: string }> }) {
  const actor = await requirePermission('support-cases.write');
  const caseId = Number((await params).id);
  if (!Number.isSafeInteger(caseId) || caseId < 1) throw new Error('Support Case not found.');
  const zone = await supportUserZone(actor);
  const { before, retryPage } = await searchParams;
  const suffix = (cursor?: string | number, retry?: string | number) => {
    const query = new URLSearchParams();
    if (cursor !== undefined) query.set('before', String(cursor));
    if (retry !== undefined) query.set('retryPage', String(retry));
    return query.size ? `?${query}` : '';
  };
  let review;
  try { review = await caseEmailFileContext(prisma, actor, caseId, before === undefined ? undefined : Number(before), undefined, retryPage === undefined ? 0 : Number(retryPage)); }
  catch { return <Content><PageHeader eyebrow={NAV_CATEGORIES.support} title="Email attachments"/><p role="alert" className="panel p-4">Email files are unavailable or this Case cannot accept attachments. The saved Case and email links are unchanged.</p><Link className="btn-secondary mt-4" href={`/support/cases/${caseId}`}>Back to Case</Link></Content>; }
  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.support} title="Email attachments" description="Review files from linked email and retry optional imports. Gmail remains read-only." action={<Link href={`/support/cases/${caseId}`} className="btn-secondary">Back to Case</Link>}/>
    {!!review.unavailable.length && <section aria-label="Unavailable email sources" className="panel mb-5 space-y-2 p-4"><h2 className="font-semibold">Some email sources are unavailable</h2>{review.unavailable.map((item, index) => <p key={`${item.messageId}-${index}`} className="text-sm"><span className="font-medium break-all">{item.messageId}</span>: {item.reason}</p>)}<Link className="btn-secondary" href={`/support/cases/${caseId}/email-attachments${suffix(before, retryPage)}`}>Retry source review</Link></section>}
    {review.groups.map(group => <CaseEmailFilesForm key={group.token} caseId={caseId} token={group.token} files={group.options} zone={zone}/>)}
    {!review.groups.length && <p className="panel p-4">No available linked emails were found.</p>}
    <nav aria-label="Email attachment pages" className="mt-4 flex gap-3">
      {(before !== undefined || retryPage !== undefined) && <Link className="btn-secondary" href={`/support/cases/${caseId}/email-attachments`}>Newest linked emails</Link>}
      {review.nextCursor !== null && <Link className="btn-secondary" href={`/support/cases/${caseId}/email-attachments${suffix(review.nextCursor, retryPage)}`}>Older linked emails</Link>}
      {review.nextRetryPage !== null && <Link className="btn-secondary" href={`/support/cases/${caseId}/email-attachments${suffix(before, review.nextRetryPage)}`}>More failed email sources</Link>}
    </nav>
  </Content>;
}
