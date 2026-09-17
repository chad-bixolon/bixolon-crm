"use client";
import { addressFields, type Address } from "@/lib/address";

export function AddressFields({ initial, errors }: { initial?: Address; errors: Record<string, string> }) {
  return <fieldset className="sm:col-span-2 border-t border-slate-200 pt-5">
    <legend className="text-base font-semibold text-slate-900">Address <span className="text-sm font-normal text-slate-500">(optional)</span></legend>
    <div className="grid gap-5 pt-2 sm:grid-cols-2">
      {addressFields.map(([key, label, limit]) => <div key={key} className={key === "addressLine1" || key === "addressLine2" ? "sm:col-span-2" : ""}>
        <label className="label" htmlFor={key}>{label}</label>
        <input className="field" id={key} name={key} maxLength={limit} defaultValue={initial?.[key] ?? ""} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined}/>
        {errors[key] && <p id={`${key}-error`} className="mt-1 text-sm text-red-700">{errors[key]}</p>}
      </div>)}
    </div>
  </fieldset>;
}
