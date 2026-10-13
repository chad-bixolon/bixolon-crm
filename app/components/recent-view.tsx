'use client';
import { startTransition, useEffect } from 'react';
import type { RecentEntityType } from '@prisma/client';
import { recordView } from '@/app/recent-items/actions';

/** Mounted by authorized record pages only: server rendering/prefetch never records a view. */
export function RecentView({ entityType, recordId }: { entityType: RecentEntityType; recordId: number }) {
  useEffect(() => {
    startTransition(async () => {
      try {
        await recordView(entityType, recordId);
        window.dispatchEvent(new Event('saleshub:recent-viewed'));
      } catch { /* History must not interrupt record access. */ }
    });
  }, [entityType, recordId]);
  return null;
}
