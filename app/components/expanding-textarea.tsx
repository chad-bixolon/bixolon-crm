'use client';

import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';

function expandToContent(textarea: HTMLTextAreaElement) {
  // Grow only when needed, retaining space the user made with the resize handle.
  // CSS caps the visible height and provides scrolling beyond that limit.
  if (textarea.scrollHeight <= textarea.clientHeight) return;
  const style = getComputedStyle(textarea);
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  textarea.style.height = `${textarea.scrollHeight + border}px`;
}

export function ExpandingTextarea({ onInput, rows = 5, defaultValue, value, ...props }: ComponentPropsWithoutRef<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    expandToContent(textarea);
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      // Reflow wrapped text when the field's width changes, without fighting
      // manual vertical resizing or observing our own height adjustments.
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      expandToContent(textarea);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [defaultValue, value]);

  return <textarea {...props} ref={ref} rows={rows} defaultValue={defaultValue} value={value} onInput={event => {
    expandToContent(event.currentTarget);
    onInput?.(event);
  }}/>;
}
