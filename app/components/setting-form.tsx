"use client";
import { submitPreservingForm } from '@/lib/submit-preserving-form';
import { useActionState } from "react";
import { submitSetting } from "@/app/administration/settings/actions";
export function SettingForm({ settingKey, label, description, value, min, max }: { settingKey: string; label: string; description?: string; value: number; min: number; max: number }) {
  const [state, action, pending] = useActionState(submitSetting.bind(null, settingKey), { message: "", success: false });
  const inputId = `setting-${settingKey}`;
  return <form action={action} onSubmit={event => submitPreservingForm(event, action)} className="py-3"><label className="label" htmlFor={inputId}>{label}</label><div className="inline-field-action"><div className="w-full max-w-40"><input id={inputId} className="field" name="value" type="number" min={min} max={max} required defaultValue={value}/></div><button className="btn-primary" disabled={pending}>Save</button></div>{description && <p className="mt-1.5 text-sm text-slate-600">{description}</p>}{state.message && <p role="status" className={state.success ? "mt-1.5 text-sm text-green-700" : "mt-1.5 text-sm text-red-700"}>{state.message}</p>}</form>;
}
