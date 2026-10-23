'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoForm({ hasCustomLogo, companyName }: { hasCustomLogo: boolean; companyName: string }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  async function upload(form: FormData) {
    setPending(true); setMessage('');
    try {
      const response = await fetch('/api/branding/logo', { method: 'POST', body: form });
      const result = await response.json();
      setMessage(result.error ?? 'Logo uploaded.');
      if (response.ok) router.refresh();
    } catch { setMessage('Could not upload logo.'); }
    finally { setPending(false); }
  }
  async function reset() {
    setPending(true); setMessage('');
    try {
      const response = await fetch('/api/branding/logo', { method: 'DELETE' });
      setMessage(response.ok ? 'Default logo restored.' : 'Could not reset logo.');
      if (response.ok) router.refresh();
    } catch { setMessage('Could not reset logo.'); }
    finally { setPending(false); }
  }
  return <section className="panel mt-5 max-w-3xl space-y-4 p-5"><h2 className="text-lg font-semibold">Company Logo</h2><p className="text-sm text-slate-600">Shown on sign-in and in the navigation. Upload a PNG, JPEG, or WebP image up to 1 MB.</p>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={hasCustomLogo ? '/api/branding/logo' : '/brand/bixolon-logo.png'} alt={`${companyName} logo preview`} className="max-h-20 max-w-full object-contain" />
    <form action={upload} className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm font-medium">Choose logo<input className="field mt-1" type="file" name="file" accept="image/png,image/jpeg,image/webp" required/></label><button disabled={pending} className="btn-primary">Upload logo</button></form>
    {hasCustomLogo && <button disabled={pending} type="button" className="btn-secondary" onClick={reset}>Reset to default logo</button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
