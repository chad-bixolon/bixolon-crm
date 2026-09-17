"use client";
import { useActionState } from "react";
import { submitSetting } from "@/app/administration/settings/actions";
export function SettingForm({ settingKey, label, value, min, max }: { settingKey: string; label: string; value: number; min: number; max: number }) {
  const [state, action, pending] = useActionState(submitSetting.bind(null, settingKey), { message: "", success: false });
  return <form action={action} className="border-t py-4"><div className="flex flex-wrap items-end gap-3"><label className="label">{label}<input className="field w-40" name="value" type="number" min={min} max={max} required defaultValue={value}/></label><button className="btn-secondary" disabled={pending}>Save</button></div>{state.message && <p role="status" className={state.success ? "text-green-700" : "text-red-700"}>{state.message}</p>}</form>;
}
