export type FilterDefaults = Record<string, string>;

export function countActiveFilters(values: Record<string, string | undefined>, defaults: FilterDefaults = {}) {
  return Object.entries(values).filter(([name, value]) => {
    if (['page', 'pageSize', 'attentionPage', 'detailSkuId', 'sort', 'dir', 'view', 'group', 'saved', 'error'].includes(name) || name.endsWith('Query') || name.endsWith('Label')) return false;
    return (value?.trim() || defaults[name] || '') !== (defaults[name] ?? '').trim();
  }).length;
}

export function countOpportunityFilters(values: Record<string, string | undefined>) {
  const other = Object.fromEntries(Object.entries(values).filter(([key]) => !['closePeriod', 'closeFrom', 'closeTo'].includes(key)));
  return countActiveFilters(other) + (values.closePeriod || values.closeFrom || values.closeTo ? 1 : 0);
}

