'use client';

import { useState } from 'react';
import type { ContactOption } from '@/lib/activity-relations';
import { EntityPicker, type PickerResult } from './entity-picker';

type Props = { contacts: ContactOption[]; selectedIds: number[]; onChange: (ids: number[]) => void; onFound?: (contact: ContactOption) => void; accountId: number; error?: string };

export function ActivityContactPicker({ contacts, selectedIds, onChange, onFound, accountId, error }: Props) {
  const [known, setKnown] = useState(contacts);
  const [toAdd, setToAdd] = useState<PickerResult | null>(null);
  const selected = selectedIds.map(id => ({ id, contact: known.find(contact => contact.id === id) }));
  return <div className="sm:col-span-2">
    <p className="mb-2 text-xs text-slate-600">Contacts from the selected Account and Contacts without an Account are available.</p>
    <div className="flex flex-wrap items-end gap-2"><div className="min-w-60 flex-1"><EntityPicker type="contact" label="Contacts involved in this activity" value={toAdd} onChange={setToAdd} filters={{ accountId, includeUnassigned: true }} disabled={!accountId} placeholder={accountId ? 'Search Contacts...' : 'Choose an Account first'}/></div><button type="button" className="btn-secondary" disabled={!toAdd || selectedIds.includes(toAdd.id)} onClick={() => { if (!toAdd || selectedIds.includes(toAdd.id)) return; const contact = toAdd; const row = { id: contact.id, name: contact.name, accountId: contact.accountId ?? null, accountName: contact.context, email: contact.email, active: true }; setKnown(old => old.some(item => item.id === row.id) ? old : [...old, row]); onFound?.(row); onChange([...selectedIds, contact.id]); setToAdd(null); }}>Add Contact</button></div>
    {selected.length ? <div className="mt-3 space-y-2" aria-label="Selected Contacts">{selected.map(({ id, contact }) => <div key={id} className="flex flex-wrap items-center gap-3 rounded border border-slate-200 p-3 text-sm"><input type="hidden" name="contactIds" value={id}/><span className="min-w-0 flex-1 break-words">{contact ? `${contact.name}${contact.email ? ` · ${contact.email}` : ''}${contact.accountName ? ` · ${contact.accountName}` : ''}` : 'Contact (review relationship)'}{contact?.archivedAt ? <span className="ml-2 text-xs text-slate-500">Archived</span> : contact && !contact.active ? <span className="ml-2 text-xs text-slate-500">Inactive</span> : null}</span><button type="button" className="btn-secondary" aria-label={`Remove ${contact?.name ?? 'Contact'}`} onClick={() => onChange(selectedIds.filter(selectedId => selectedId !== id))}>Remove</button></div>)}</div> : <p className="mt-3 text-sm text-slate-500">No Contacts selected.</p>}
    {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
