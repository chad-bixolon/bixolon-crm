export type RecordVisibility = 'active' | 'archived' | 'all';

export function recordVisibility(value: string | undefined): RecordVisibility {
  return value === 'archived' || value === 'all' ? value : 'active';
}

export function archivedWhere(visibility: RecordVisibility) {
  return visibility === 'all' ? {} : { archivedAt: visibility === 'archived' ? { not: null } : null };
}
