"use client";
import { useActionState } from "react";
import { changeArchiveState, type FormState } from "@/app/accounts/actions";
export function ArchiveControl({ id, archived }: { id: number; archived: boolean }) {
  const [state, action, pending] = useActionState(changeArchiveState.bind(null, id, !archived), { errors: {} } as FormState);
  return <form action={action} className="flex items-center gap-3"><button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">{pending ? "Updating…" : archived ? "Reactivate account" : "Archive account"}</button>{state.message && <span role="status" className="text-sm text-slate-600">{state.message}</span>}</form>;
}
