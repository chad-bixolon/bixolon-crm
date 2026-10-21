import Link from 'next/link';
import { detailPageHref, type DetailPage } from '@/lib/detail-pagination';

export function DetailPagination({ pagination, basePath, parameter = 'page', label }: {
  pagination: DetailPage; basePath: string; parameter?: string; label: string;
}) {
  if (pagination.pages <= 1) return null;
  return <nav aria-label={`${label} pages`} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
    <span>{pagination.total} records · Page {pagination.page} of {pagination.pages}</span>
    <div className="flex gap-2">
      {pagination.page > 1 && <Link className="btn-secondary" href={detailPageHref(basePath, parameter, pagination.page - 1)}>Previous</Link>}
      {pagination.page < pagination.pages && <Link className="btn-secondary" href={detailPageHref(basePath, parameter, pagination.page + 1)}>Next</Link>}
    </div>
  </nav>;
}
