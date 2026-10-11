'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { countActiveFilters, type FilterDefaults } from '../lib/filter-count';

export function FilterDisclosure({ initialCount, clearHref, defaults = {} }: { initialCount: number; clearHref: string; defaults?: FilterDefaults }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialCount);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    form.id = `${id}-controls`;
    const update = () => {
      const entries = Object.fromEntries(new FormData(form).entries());
      const values = Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, String(value)]));
      setCount(countActiveFilters(values, defaults));
    };
    const afterClick = () => requestAnimationFrame(update);
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('click', afterClick);
    return () => { form.removeEventListener('input', update); form.removeEventListener('change', update); form.removeEventListener('click', afterClick); };
  }, [defaults, id]);
  return <div ref={ref} className="filter-disclosure" id={id}>
    <button type="button" className="filter-disclosure-button" aria-label={`${open ? 'Hide' : 'Show'} filters${count ? `, ${count} active` : ''}`} aria-expanded={open} aria-controls={`${id}-controls`} onClick={() => setOpen(value => !value)}>
      <span>Filters{count > 0 ? ` · ${count} active` : ''}</span><span aria-hidden="true">{open ? '▾' : '▸'}</span>
    </button>
    {count > 0 && <Link className="filter-disclosure-clear" href={clearHref}>Clear</Link>}
  </div>;
}
