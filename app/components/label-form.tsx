"use client";
import { useActionState } from "react";
import { submitLabel } from "@/app/administration/labels/actions";
export function LabelForm({ labelKey, value, overridden }: { labelKey: string; value: string; overridden: boolean }) {
  const [saveState, saveAction, saving] = useActionState(submitLabel.bind(null, labelKey, "save"), { message: "", success: false });
  const [restoreState, restoreAction, restoring] = useActionState(submitLabel.bind(null, labelKey, "restore"), { message: "", success: false });
  return <div className="border-t py-4"><div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto_auto] sm:items-end"><code className="text-sm font-semibold">{labelKey}</code><form action={saveAction} id={`label-${labelKey}`}><label className="label" htmlFor={`input-${labelKey}`}>Display label</label><input id={`input-${labelKey}`} className="field" name="displayLabel" required maxLength={80} defaultValue={value}/></form><button form={`label-${labelKey}`} className="btn-secondary" disabled={saving}>Save</button><form action={restoreAction}><button className="btn-secondary" disabled={!overridden || restoring}>Restore default</button></form></div>{saveState.message && <p role="status" className={saveState.success ? "text-green-700" : "text-red-700"}>{saveState.message}</p>}{restoreState.message && <p role="status" className={restoreState.success ? "text-green-700" : "text-red-700"}>{restoreState.message}</p>}</div>;
}
