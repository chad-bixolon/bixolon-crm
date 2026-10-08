'use client';
import { useState } from 'react';
import { ImportSearchPicker } from './import-search-picker';

export function AudienceContactPicker({ contacts }: { contacts: { id: number; name: string }[] }) {
  const [id, setId] = useState<number | null>(null);
  return <div><label className="label">Manually include Contact</label><ImportSearchPicker label="Contact" items={contacts} value={id} onChange={setId} emptyLabel="Choose Contact"/><input type="hidden" name="contactId" value={id ?? ''}/></div>;
}
