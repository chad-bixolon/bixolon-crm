'use client';
import { useActionState } from 'react';
import { saveBrandingAction } from './actions';

export function BrandingForm({ companyName, productName }: { companyName: string; productName: string }) {
  const [state, action, pending] = useActionState(saveBrandingAction, { message: '' });
  return <form action={action} className="panel max-w-3xl space-y-4 p-5"><div><label className="label" htmlFor="companyName">Company Name</label><input className="field" id="companyName" name="companyName" defaultValue={companyName} maxLength={200} required/></div><div><label className="label" htmlFor="productName">Product Name</label><input className="field" id="productName" name="productName" defaultValue={productName} maxLength={200} required/></div><p className="text-sm text-slate-600">These names appear in the sign-in page, navigation, Dashboard, and Help. They do not rename CRM records.</p><button className="btn-primary" disabled={pending}>Save names</button>{state.message && <p role="status" className="text-sm">{state.message}</p>}</form>;
}
