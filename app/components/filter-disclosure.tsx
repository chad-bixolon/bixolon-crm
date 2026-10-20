'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { countActiveFilters, countOpportunityFilters, countTaskFilters, type FilterDefaults } from '../lib/filter-count';

export function FilterDisclosure({ initialCount, clearHref, defaults = {}, opportunityClosePeriod = false, taskDuePeriod = false, queryKey = '' }: { initialCount: number; clearHref: string; defaults?: FilterDefaults; opportunityClosePeriod?: boolean; taskDuePeriod?: boolean; queryKey?: string }) {
  const [open, setOpen] = useState(false);
  const [draftCount, setDraftCount] = useState<{ queryKey: string; value: number } | null>(null);
  if (draftCount && draftCount.queryKey !== queryKey) setDraftCount(null);
  // A restored URL starts with its server count without collapsing the disclosure.
  const count = draftCount?.queryKey === queryKey ? draftCount.value : initialCount;
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    form.id = `${id}-controls`;
    const update = () => {
      const entries = Object.fromEntries(new FormData(form).entries());
      const values = Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, String(value)]));
      setDraftCount({ queryKey, value: opportunityClosePeriod ? countOpportunityFilters(values) : taskDuePeriod ? countTaskFilters(values) : countActiveFilters(values, defaults) });
    };
    let pending = 0;
    const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(update); };
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    form.addEventListener('click', schedule);
    return () => { cancelAnimationFrame(pending); form.removeEventListener('input', schedule); form.removeEventListener('change', schedule); form.removeEventListener('click', schedule); };
  }, [defaults, id, opportunityClosePeriod, taskDuePeriod, queryKey]);
  return <div ref={ref} className="filter-disclosure" id={id}>
    <button type="button" className="filter-disclosure-button" aria-label={`${open ? 'Hide' : 'Show'} filters${count ? `, ${count} active` : ''}`} aria-expanded={open} aria-controls={`${id}-controls`} onClick={() => setOpen(value => !value)}>
      <span>Filters{count > 0 ? ` · ${count} active` : ''}</span><span aria-hidden="true">{open ? '▾' : '▸'}</span>
    </button>
    {count > 0 && <Link className="filter-disclosure-clear" href={clearHref}>Clear</Link>}
  </div>;
}
