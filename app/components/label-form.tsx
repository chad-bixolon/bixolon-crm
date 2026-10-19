"use client";
import { submitPreservingForm } from '@/lib/submit-preserving-form';
import { defaultLabels } from '@/lib/configuration';
import { useActionState } from "react";
import { submitLabel } from "@/app/administration/labels/actions";
export function LabelForm({ labelKey, value, overridden }: { labelKey: string; value: string; overridden: boolean }) {
  const [saveState, saveAction, saving] = useActionState(submitLabel.bind(null, labelKey, "save"), { message: "", success: false });
  const [restoreState, restoreAction, restoring] = useActionState(submitLabel.bind(null, labelKey, "restore"), { message: "", success: false });
  return <div className="border-t py-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[12rem_minmax(0,1fr)_auto_auto] sm:items-end"><div className="min-w-0"><p className="text-sm font-semibold">{defaultLabels[labelKey as keyof typeof defaultLabels]}</p><details className="mt-1 text-xs text-slate-500"><summary className="cursor-pointer">Reference key</summary><code>{labelKey}</code></details></div><form action={saveAction} onSubmit={event => submitPreservingForm(event, saveAction)} id={`label-${labelKey}`}><label className="label" htmlFor={`input-${labelKey}`}>Display label</label><input id={`input-${labelKey}`} className="field" name="displayLabel" required maxLength={80} defaultValue={value}/></form><button form={`label-${labelKey}`} className="btn-secondary" disabled={saving}>Save</button><form action={restoreAction}><button className="btn-secondary" disabled={!overridden || restoring}>Restore default</button></form></div>{saveState.message && <p role="status" className={saveState.success ? "text-green-700" : "text-red-700"}>{saveState.message}</p>}{restoreState.message && <p role="status" className={restoreState.success ? "text-green-700" : "text-red-700"}>{restoreState.message}</p>}</div>;
}
