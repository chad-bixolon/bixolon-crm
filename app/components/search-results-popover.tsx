'use client';

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Placement = { top: number; left: number; width: number; maxHeight: number };
const gap = 4;
const edge = 8;

export function resultPlacement(rect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>, viewportWidth: number, viewportHeight: number): Placement {
  const below = Math.max(0, viewportHeight - rect.bottom - gap - edge);
  const above = Math.max(0, rect.top - gap - edge);
  const opensAbove = below < 160 && above > below;
  const maxHeight = Math.min(320, opensAbove ? above : below);
  const width = Math.min(rect.width, Math.max(0, viewportWidth - edge * 2));
  return {
    top: opensAbove ? Math.max(edge, rect.top - gap - maxHeight) : rect.bottom + gap,
    left: Math.max(edge, Math.min(rect.left, viewportWidth - edge - width)),
    width,
    maxHeight,
  };
}

export function SearchResultsPopover({ anchorRef, id, activeIndex, children }: {
  anchorRef: RefObject<HTMLInputElement | null>;
  id: string;
  activeIndex: number;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const input = anchorRef.current;
      if (input) {
        const next = resultPlacement(input.getBoundingClientRect(), window.innerWidth, window.innerHeight);
        setPlacement(current => current && Object.keys(next).every(key => current[key as keyof Placement] === next[key as keyof Placement]) ? current : next);
      }
    };
    const onScroll = (event: Event) => {
      if (event.target !== menuRef.current) update();
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorRef]);

  useLayoutEffect(() => {
    const option = menuRef.current?.querySelector<HTMLElement>(`[data-result-index="${activeIndex}"]`);
    if (option && menuRef.current) {
      const menu = menuRef.current;
      if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight)
        menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
  }, [activeIndex, children, placement]);

  if (!placement || typeof document === 'undefined') return null;
  return createPortal(<div ref={menuRef} id={id} role="listbox" className="search-results-popover" style={placement}>
    {children}
  </div>, document.body);
}
