'use client';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [scroll, setScroll] = useState({ max: 0, position: 0, thumb: 32 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const thumb = Math.max(32, Math.round(Math.max(viewport.clientWidth - 32, 0) * viewport.clientWidth / Math.max(viewport.scrollWidth, 1)));
      setScroll({ max, position: Math.min(viewport.scrollLeft, max), thumb });
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    update();
    return () => observer.disconnect();
  }, [children]);
  return <>
    <div id={id} ref={viewportRef} role="region" aria-label={`${label} table`} tabIndex={0} onScroll={event => {
      setScroll(current => ({ ...current, position: event.currentTarget.scrollLeft }));
    }} className="report-table-viewport max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-orange-600">
      {children}
    </div>
    {scroll.max > 1 && <div className="report-scroll-control"><input className="report-scroll-range" type="range" min={0} max={scroll.max} step={1} value={scroll.position} aria-label={`Scroll ${label} horizontally`} aria-controls={id} style={{ '--report-thumb-width': `${scroll.thumb}px` } as CSSProperties} onChange={event => { if (viewportRef.current) viewportRef.current.scrollLeft = Number(event.target.value); }}/></div>}
  </>;
}
