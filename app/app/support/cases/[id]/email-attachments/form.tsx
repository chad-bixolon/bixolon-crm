'use client';
import { useActionState } from 'react';
import { useSubmitGuard } from '@/lib/submit-guard';
import { EmailFileSelection } from '@/components/email-file-selection';
import type { EmailFileOption } from '@/lib/support-email-file-import';
import { saveEmailFiles } from './actions';
export function CaseEmailFilesForm({ caseId, token, files, zone }: { caseId: number; token: string; files: EmailFileOption[]; zone: string }) {
  const [state, action, pending] = useActionState(saveEmailFiles.bind(null, caseId), {});
  const guard = useSubmitGuard(state, action);
  return <form onSubmit={guard} className="panel mb-5 space-y-4 p-4"><input type="hidden" name="emailSource" value={token}/><EmailFileSelection files={files} zone={zone} disabled={pending}/>{state.message && <p role="alert" className="text-sm text-red-700">{state.message}</p>}{state.failures?.map(file => <p key={file.name} role="alert" className="text-sm text-red-700">{file.name}: {file.reason}</p>)}<button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Importing…' : 'Import selected files'}</button></form>;
}
