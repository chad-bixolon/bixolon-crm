export const DETAIL_PAGE_SIZE = 25;

export function detailPage(total: number, raw?: string) {
  const parsed = Number(raw);
  const pages = Math.max(1, Math.ceil(total / DETAIL_PAGE_SIZE));
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, pages) : 1;
  return { total, page, pages, skip: (page - 1) * DETAIL_PAGE_SIZE, take: DETAIL_PAGE_SIZE };
}
export type DetailPage = ReturnType<typeof detailPage>;

export function detailPageHref(basePath: string, parameter: string, page: number) {
  const [base, hash] = basePath.split('#');
  const [path, query] = base.split('?');
  const params = new URLSearchParams(query);
  params.set(parameter, String(page));
  return `${path}?${params}${hash ? `#${hash}` : ''}`;
}
