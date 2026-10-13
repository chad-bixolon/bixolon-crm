'use client';

import { useEffect, type RefObject } from 'react';

export function useDismissOnOutside<T extends HTMLElement>(open: boolean | (() => boolean), container: RefObject<T | null>, dismiss: () => void) {
  useEffect(() => {
    if (typeof open === 'boolean' && !open) return;
    const isOpen = () => typeof open === 'function' ? open() : open;
    const onPointerDown = (event: PointerEvent) => {
      if (isOpen() && event.target instanceof Node && !container.current?.contains(event.target)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOpen() && event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, container, dismiss]);
}
