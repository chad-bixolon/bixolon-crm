"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import styles from "./products-page.module.css";

const interactiveSelector = 'a, button, input, select, textarea, summary, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"])';

export function ProductTableRow({ id, name, children }: { id: number; name: string; children: ReactNode }) {
  const router = useRouter();
  const href = `/products/${id}/edit`;

  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const interactive = event.target instanceof Element ? event.target.closest(interactiveSelector) : null;
    if (interactive && interactive !== event.currentTarget) return;
    router.push(href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  }

  return <tr role="link" aria-label={`Edit product ${name}`} tabIndex={0} onClick={handleClick} onKeyDown={handleKeyDown} className={styles.row}>{children}</tr>;
}
