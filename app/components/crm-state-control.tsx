"use client";
import { useActionState } from "react";
import { changeContactState } from "@/app/contacts/actions";
import { changeProductState } from "@/app/products/actions";
import { changeOpportunityArchive } from "@/app/opportunities/actions";
import { RecordChangedNotice } from './record-changed-notice';
type State = { errors: Record<string, string>; message?: string };
export function CrmStateControl({ kind, id, state, editToken }: { kind: "contact" | "product" | "opportunity"; id: number; state: "active" | "inactive" | "archived"; editToken?: string }) {
  const desired = state === "active" ? "inactive" : "active";
  const handler = kind === "contact" ? changeContactState.bind(null, id, desired) : kind === "product" ? changeProductState.bind(null, id, desired) : changeOpportunityArchive.bind(null, id, state !== "archived");
  const [result, action, pending] = useActionState(handler, { errors: {} } as State);
  return <form onSubmit={event => { if (kind !== "product" && !window.confirm("Confirm this record status change?")) event.preventDefault(); }} action={action} className="inline-flex items-center gap-2">{kind === 'product' && <input type="hidden" name="editToken" value={editToken ?? ''}/>}<button className="btn-secondary disabled:opacity-60" disabled={pending}>{pending ? "Updating…" : state === "archived" ? "Reactivate" : kind === "opportunity" ? "Archive" : state === "active" ? "Deactivate" : "Activate"}</button>{'recordChanged' in result && result.recordChanged && kind === 'product' ? <RecordChangedNotice result={result} href={`/products/${id}/edit`}/> : result.message && <span role="status" className="text-sm text-slate-600">{result.message}</span>}</form>;
}
export function ArchiveCrmControl({ kind, id, editToken }: { kind: "contact" | "product"; id: number; editToken?: string }) {
  const handler = kind === "contact" ? changeContactState.bind(null, id, "archived") : changeProductState.bind(null, id, "archived");
  const [result, action, pending] = useActionState(handler, { errors: {} } as State);
  return <form onSubmit={event => { if (kind !== "product" && !window.confirm("Confirm this record status change?")) event.preventDefault(); }} action={action} className="inline-flex items-center gap-2">{kind === 'product' && <input type="hidden" name="editToken" value={editToken ?? ''}/>}<button className="btn-secondary disabled:opacity-60" disabled={pending}>{pending ? "Archiving…" : "Archive"}</button>{'recordChanged' in result && result.recordChanged && kind === 'product' ? <RecordChangedNotice result={result} href={`/products/${id}/edit`}/> : result.message && <span role="status" className="text-sm text-slate-600">{result.message}</span>}</form>;
}
