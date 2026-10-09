'use client';
import { RemoteImportEntityPicker } from './remote-import-entity-picker';
export function RemoteImportAccountPicker(props: { value: number | null; onChange: (id: number | null) => void; items: { id: number; name: string }[]; label: string; searchPlaceholder?: string; emptyLabel?: string; disabled?: boolean; partnerOnly?: boolean }) { return <RemoteImportEntityPicker type="account" {...props} filters={props.partnerOnly ? { partnerOnly: true } : undefined}/>; }
