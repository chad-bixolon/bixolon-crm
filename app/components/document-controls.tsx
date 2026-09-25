'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SaveSuccess, useQueryValue } from './save-success';
import { ACCEPTED_DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES } from '@/lib/document-constants';

type Parent = { type: 'account' | 'project' | 'opportunity'; id: number };

export function DocumentUpload({ parent, types }: { parent: Parent; types: { value: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname(), searchParams = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(form: FormData) {
    setError(null);
    const file = form.get('file');
    if (!(file instanceof File) || !file.name) return setError('Choose a document to upload.');
    if (file.size > MAX_DOCUMENT_BYTES) return setError('Documents must be 25 MB or smaller.');
    setBusy(true);
    try {
      const response = await fetch(`/api/documents?parentType=${parent.type}&parentId=${parent.id}`, { method: 'POST', body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The document could not be uploaded.');
      formRef.current?.reset(); setOpen(false);
      const query = new URLSearchParams(searchParams.toString()); query.set('saved', 'document-uploaded');
      router.replace(`${pathname}?${query}#documents`);
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'The document could not be uploaded.'); }
    finally { setBusy(false); }
  }
  return <>
    <button className="btn-primary" type="button" onClick={() => { setOpen(value => !value); setError(null); }}>{open ? 'Cancel' : 'Upload Document'}</button>
    {open && <form ref={formRef} className="mt-4 grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2" action={submit}>
      <label className="sm:col-span-2"><span className="label">File</span><input className="field" required name="file" type="file" accept={ACCEPTED_DOCUMENT_EXTENSIONS}/><span className="mt-1 block text-xs text-slate-500">PDF, Word, Excel, or PowerPoint · maximum 25 MB</span></label>
      <label><span className="label">Document Type</span><select className="field" required name="documentType" defaultValue=""><option value="" disabled>Choose a type</option>{types.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
      <label><span className="label">Description <span className="font-normal normal-case">(optional)</span></span><input className="field" name="description" maxLength={2000}/></label>
      {error && <p className="sm:col-span-2 text-sm font-medium text-red-700" role="alert">{error}</p>}
      <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button></div>
    </form>}
  </>;
}

export function DocumentArchive({ id, archived = false }: { id: number; archived?: boolean }) {
  const router = useRouter();
  const pathname = usePathname(), searchParams = useSearchParams();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function archive() {
    if (!archived && !window.confirm('Archive this document?\n\nArchived documents are removed from the active list but retained.')) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/documents/${id}/${archived ? 'restore' : 'archive'}`, { method: 'POST' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The document could not be archived.');
      const query = new URLSearchParams(searchParams.toString()); query.set('saved', archived ? 'document-restored' : 'document-archived');
      router.replace(`${pathname}?${query}#documents`);
    } catch (archiveError) { setError(archiveError instanceof Error ? archiveError.message : 'The document could not be archived.'); }
    finally { setBusy(false); }
  }
  return <div className="inline-flex flex-col items-start gap-1"><button className="text-orange-800 underline disabled:text-slate-400" type="button" disabled={busy} onClick={archive}>{busy ? (archived ? 'Restoring…' : 'Archiving…') : (archived ? 'Restore' : 'Archive')}</button>{error && <span className="text-xs text-red-700" role="alert">{error}</span>}</div>;
}

export function DocumentFeedback() {
  const status = useQueryValue('saved');
  if (status === 'document-uploaded') return <div className="mb-4"><SaveSuccess message="Document uploaded successfully."/></div>;
  if (status === 'document-restored') return <div className="mb-4"><SaveSuccess message="Document restored."/></div>;
  if (status === 'document-archived') return <div className="mb-4"><SaveSuccess message="Document archived."/></div>;
  return null;
}
