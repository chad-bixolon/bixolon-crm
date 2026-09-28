'use client';

import { useState } from 'react';
import type { ContactOption } from '@/lib/activity-relations';
import { activityContactLabel, searchActivityContacts } from '@/lib/activity-contact-picker';

type Props = {
  contacts: ContactOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  accountSelected: boolean;
  error?: string;
};

export function ActivityContactPicker({ contacts, selectedIds, onChange, accountSelected, error }: Props) {
  const [query, setQuery] = useState('');
  const [contactToAdd, setContactToAdd] = useState('');
  const searchActive = query.trim().length > 0;
  const matches = searchActivityContacts(contacts, query, selectedIds);
  const available = matches.slice(0, 50);
  const selected = selectedIds.map(id => ({ id, contact: contacts.find(contact => contact.id === id) }));

  function addContact() {
    const id = Number(contactToAdd);
    if (!available.some(contact => contact.id === id)) return;
    onChange([...selectedIds, id]);
    setContactToAdd('');
    setQuery('');
  }

  return <div className="sm:col-span-2">
    <label className="label" htmlFor="activityContactSearch">Contacts involved in this activity</label>
    <p id="activityContactHelp" className="mb-2 text-xs text-slate-500">Select the people involved in this activity. Contacts from the selected Account are shown, along with Contacts that are not yet assigned to an Account.</p>
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-60 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <input className="field" id="activityContactSearch" type="search" value={query} onChange={event => { setQuery(event.target.value); setContactToAdd(''); }} placeholder="Search name, email, or company" aria-describedby={searchActive ? 'activityContactHelp activityContactMatchCount' : 'activityContactHelp'} disabled={!accountSelected}/>
          {query && <button type="button" className="btn-secondary shrink-0" onClick={() => { setQuery(''); setContactToAdd(''); }}>Clear search</button>}
        </div>
        {accountSelected && searchActive && <p id="activityContactMatchCount" className="mb-2 text-xs text-slate-600" aria-live="polite">{matches.length === 0 ? 'No contacts match' : `${matches.length} ${matches.length === 1 ? 'contact matches' : 'contacts match'}`}</p>}
        <select className="field" aria-label="Contact search results" value={contactToAdd} onChange={event => setContactToAdd(event.target.value)} disabled={!accountSelected}>
          <option value="">{accountSelected ? searchActive ? 'Choose from filtered contacts' : 'Choose Contact' : 'Choose an Account first'}</option>
          {available.map(contact => <option key={contact.id} value={contact.id}>{activityContactLabel(contact)}{!contact.active ? ' (inactive, linked)' : ''}</option>)}
        </select>
      </div>
      <button type="button" className="btn-secondary" disabled={!contactToAdd} onClick={addContact}>Add Contact</button>
    </div>
    {accountSelected && !searchActive && available.length === 0 && <p className="mt-2 text-sm text-slate-500">No matching Contacts.</p>}
    {selected.length ? <div className="mt-3 space-y-2" aria-label="Selected Contacts">{selected.map(({ id, contact }) => <div key={id} className="flex flex-wrap items-center gap-3 rounded border border-slate-200 p-3 text-sm">
      <input type="hidden" name="contactIds" value={id}/>
      <span className="min-w-0 flex-1 break-words">{contact ? activityContactLabel(contact) : `Contact #${id} (review relationship)`}</span>
      <button type="button" className="btn-secondary" aria-label={`Remove ${contact?.name ?? `Contact #${id}`}`} onClick={() => onChange(selectedIds.filter(selectedId => selectedId !== id))}>Remove</button>
    </div>)}</div> : <p className="mt-3 text-sm text-slate-500">No Contacts selected.</p>}
    {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
