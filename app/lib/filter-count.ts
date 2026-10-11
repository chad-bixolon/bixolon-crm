export type FilterDefaults = Record<string, string>;

export function countActiveFilters(values: Record<string, string | undefined>, defaults: FilterDefaults = {}) {
  return Object.entries(values).filter(([name, value]) => {
    if (['page', 'pageSize', 'attentionPage', 'detailSkuId', 'sort', 'dir', 'view', 'group', 'saved', 'error'].includes(name) || name.endsWith('Query') || name.endsWith('Label')) return false;
    return (value?.trim() || defaults[name] || '') !== (defaults[name] ?? '').trim();
  }).length;
}

