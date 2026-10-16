'use client';
import type { ComponentProps } from 'react';
/** Confirmation for existing individual maintenance forms; authorization stays server-side. */
export function ConfirmMaintenanceForm({ message, ...props }: ComponentProps<'form'> & { message: string }) {
  return <form {...props} onSubmit={event => { if (!window.confirm(message)) event.preventDefault(); }}/>;
}
