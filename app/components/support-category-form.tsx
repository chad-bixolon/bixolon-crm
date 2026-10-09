'use client';
import { submitPreservingForm, useResetOnSuccess } from '@/lib/submit-preserving-form';
import { useActionState, useRef } from 'react';
import { saveCategory } from '@/app/administration/support-case-categories/actions';
export function SupportCategoryForm({ initial }: { initial?: { id: number; name: string; sortOrder: number; active: boolean } }) {
  const [state, action, pending] = useActionState(saveCategory.bind(null, initial?.id ?? null), {});
  const formRef = useRef<HTMLFormElement>(null);
  useResetOnSuccess(state, state.success && !initial, formRef);
  return <form ref={formRef} action={action} onSubmit={event => submitPreservingForm(event, action)} className="flex flex-wrap items-end gap-3"><label className="label min-w-52 flex-1">Name<input className="field mt-1" name="name" required maxLength={120} defaultValue={initial?.name}/></label><label className="label w-28">Order<input className="field mt-1" type="number" min={0} step={1} name="sortOrder" required defaultValue={initial?.sortOrder ?? 0}/></label><label className="label flex h-10 items-center gap-2"><input type="checkbox" name="active" defaultChecked={initial?.active ?? true}/>Active</label><button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save' : 'Add category'}</button>{state.message && <span role="status" className={`w-full text-sm ${state.success ? 'text-green-800' : 'text-red-700'}`}>{state.message}</span>}</form>;
}
