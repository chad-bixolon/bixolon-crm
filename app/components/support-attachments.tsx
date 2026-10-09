'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTimeForUser } from '@/lib/display-format';
import { MAX_SUPPORT_ATTACHMENT_BYTES, SUPPORT_ATTACHMENT_ACCEPT } from '@/lib/support-attachment-constants';

type Attachment = { id: number; originalFileName: string; contentType: string; fileSizeBytes: number; createdAt: Date; uploadedBy: { firstName: string; lastName: string } };
function size(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

export function SupportAttachments({ caseId, items, canWrite, zone }: { caseId: number; items: Attachment[]; canWrite: boolean; zone: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(items.length <= 3);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose a file to upload.'); return; }
    if (file.size > MAX_SUPPORT_ATTACHMENT_BYTES) { setError('File is too large. Maximum size is 25 MB.'); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      const form = new FormData(); form.set('file', file);
      const response = await fetch(`/api/support/cases/${caseId}/attachments`, { method: 'POST', body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Upload failed. Please try again.');
      if (fileRef.current) fileRef.current.value = '';
      setUploadOpen(false); setOpen(true); setSuccess('Attachment uploaded.'); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    if (!window.confirm('Remove this attachment from the case?')) return;
    setRemoving(id); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/support/attachments/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Attachment could not be removed.');
      setSuccess('Attachment removed.'); router.refresh();
    } catch { setError('Attachment could not be removed.'); }
    finally { setRemoving(null); }
  }
  return <section className="panel mb-5 min-w-0 p-4 sm:p-5" aria-label="Attachments">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Attachments · {items.length}</h2><div className="flex flex-wrap gap-2">{canWrite && <button className="btn-primary" type="button" onClick={() => { setUploadOpen(value => !value); setError(null); }}>Add Attachment</button>}<button className="btn-secondary" type="button" aria-expanded={open} aria-controls={`case-attachments-${caseId}`} onClick={() => setOpen(value => !value)}>{open ? 'Hide attachments' : 'Show attachments'}</button></div></div>
    {success && <p className="mt-3 text-sm text-green-800" role="status">{success}</p>}
    {error && <p className="mt-3 text-sm font-medium text-red-700" role="alert">{error}</p>}
    {uploadOpen && canWrite && <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><label className="min-w-0 flex-1"><span className="label">File</span><input ref={fileRef} className="field" type="file" accept={SUPPORT_ATTACHMENT_ACCEPT}/><span className="mt-1 block text-xs text-slate-500">Images, PDF, text, logs, PRN, and configuration files · maximum 25 MB</span></label><button className="btn-primary" type="button" disabled={busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</button></div>}
    {open && <div id={`case-attachments-${caseId}`} className="mt-4">{items.length ? <ul className="divide-y border-y border-slate-200">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div className="min-w-0"><p className="break-all font-medium">{item.originalFileName}</p><p className="mt-1 text-xs text-slate-600">{item.contentType} · {size(item.fileSizeBytes)} · {formatDateTimeForUser(new Date(item.createdAt), zone)} · {item.uploadedBy.firstName} {item.uploadedBy.lastName}</p></div><div className="flex gap-3"><a className="text-orange-800 underline" href={`/api/support/attachments/${item.id}/download`} target="_blank" rel="noopener noreferrer">Download</a>{canWrite && <button className="text-red-700 underline disabled:text-slate-400" type="button" disabled={removing === item.id} onClick={() => remove(item.id)}>Remove</button>}</div></li>)}</ul> : <p className="text-sm text-slate-600">No attachments have been added to this case.{canWrite && ' Upload screenshots, logs, PRN files, PDFs, or other troubleshooting files.'}</p>}</div>}
  </section>;
}
