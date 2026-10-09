'use client';
import { useState } from 'react';
import { EntityPicker, type PickerResult } from './entity-picker';
import type { EntityType } from '@/lib/entity-search';
export function RemoteImportEntityPicker({ type, value, onChange, items, label, searchPlaceholder, disabled = false, filters }: { type: EntityType; value: number | null; onChange: (id: number | null) => void; items: { id: number; name: string }[]; label: string; searchPlaceholder?: string; emptyLabel?: string; disabled?: boolean; filters?: { partnerOnly?: boolean; accountId?: number | null; includeUnassigned?: boolean } }) {
  const [known, setKnown] = useState<PickerResult | null>(null);
  const current = items.find(item => item.id === value);
  const selected = value ? known?.id === value ? known : { id: value, name: current?.name ?? `Selected ${type}`, context: null } : null;
  return <EntityPicker type={type} label={label} value={selected} onChange={item => { setKnown(item); onChange(item?.id ?? null); }} placeholder={searchPlaceholder} disabled={disabled} filters={filters}/>;
}
