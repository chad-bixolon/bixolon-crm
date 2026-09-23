'use client';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { measureTableScroll, setTableScrollPosition, updateTableScrollPosition } from './table-scroll-state.mjs';

type ScrollState = { max: number; position: number; thumb: number };

export function TableScroll({ label, children, topControl = false, bounded = false }: { label: string; children: ReactNode; topControl?: boolean; bounded?: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [scroll, setScroll] = useState<ScrollState>({ max: 0, position: 0, thumb: 0 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let mounted = true;
    const update = () => {
      if (!mounted) return;
      const next = measureTableScroll(viewport);
      setScroll(current => current.max === next.max && current.position === next.position && current.thumb === next.thumb ? current : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    update();
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, [children]);
  const control = (position: 'top'|'bottom') => scroll.max > 1 && <div className={`report-scroll-control ${position === 'top' ? 'border-b pt-2' : ''}`}><input className="report-scroll-range" type="range" min={0} max={scroll.max} step={1} value={scroll.position} aria-label={`Scroll ${label} horizontally (${position})`} aria-controls={id} style={{ '--report-thumb-width': `${scroll.thumb}px` } as CSSProperties} onChange={event => {
    const requestedPosition = Number(event.currentTarget.value);
    const viewport = viewportRef.current;
    if (!viewport) return;
    const position = setTableScrollPosition(viewport, requestedPosition);
    setScroll(current => updateTableScrollPosition(current, position));
  }}/></div>;
  return <>
    {topControl && control('top')}
    <div id={id} ref={viewportRef} role="region" aria-label={`${label} table`} tabIndex={0} onScroll={event => {
      // React only guarantees currentTarget during the handler. Capture every DOM
      // value before scheduling the state updater.
      const { scrollLeft, scrollWidth, clientWidth } = event.currentTarget;
      const position = measureTableScroll({ scrollLeft, scrollWidth, clientWidth }).position;
      setScroll(current => updateTableScrollPosition(current, position));
    }} className={`report-table-viewport max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-orange-600 ${bounded ? 'max-h-[65vh] overflow-y-auto' : ''}`}>
      {children}
    </div>
    {control('bottom')}
  </>;
}
