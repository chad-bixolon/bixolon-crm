'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { submitUserCsv, type CsvState } from '@/app/administration/users/import/actions';
export function UserCsvImport() {
  const [state, action, pending] = useActionState(submitUserCsv, {} as CsvState);
  const preview = state.preview;
  const errors = (preview?.rows.filter(r => r.action === 'Error').length ?? 0) + (preview?.errors.length ?? 0);
  return <div className="space-y-4 min-w-0">
    <div className="panel space-y-3 p-4 text-sm"><p>Importing users approves or updates CRM access. It does not create Google accounts or bypass Google sign-in.</p>
    <p>Use UTF-8 CSV with headers: <strong>First Name, Last Name, Email, Role, Active, Timezone</strong>. Maximum 500 KB, 500 rows, and 320 characters per column (names: 100).</p>
    <p>Email is trimmed and lowercased to match an existing user. A different email creates a new user; change email addresses on the individual User form. Duplicate emails and archived users are rejected.</p>
    <p>Roles: ADMIN (Administrator), SALES_MANAGER (Sales Manager), SALES, SUPPORT_MANAGER (Support Manager), SUPPORT, MARKETING_MANAGER (Marketing Manager), EXECUTIVE, READ_ONLY (Read Only). Friendly labels are also accepted.</p>
    <p>Active accepts true / false or yes / no. New users require Active and an IANA Timezone such as America/New_York, Asia/Seoul, or UTC. Blank or omitted Active and Timezone preserve existing values. User Administration Access cannot be imported.</p>
    <p>Fix every error before confirming. Changes apply together. At least one active Administrator must remain. Review active work requiring attention; historical attribution remains unchanged.</p>
    <p><Link className="underline" href="/help/user-administration">User Administration Help</Link> · <Link className="underline" href="/administration/users">Back to users</Link></p></div>
    <form action={action} className="panel flex flex-wrap items-end gap-4 p-4"><label className="min-w-0 flex-1">CSV file<input className="block w-full min-w-0 mt-2" type="file" name="file" accept=".csv,text/csv" required disabled={pending}/></label><button className="btn-primary" disabled={pending}>Upload and preview</button></form>
    {state.message && <p role="status" className="panel p-4">{state.message}</p>}
    {preview && <section className="panel min-w-0 p-4 space-y-4"><h2 className="text-lg font-semibold">{state.done ? 'Import results' : 'Review changes'}</h2>
      <p>{preview.rows.length} total rows · {preview.rows.filter(r=>r.action==='Create').length} {state.done?'created':'create'} · {preview.rows.filter(r=>r.action==='Update').length} {state.done?'updated':'update'} · {preview.rows.filter(r=>r.action==='Unchanged').length} unchanged · {errors} errors</p>
      {preview.errors.map((e,i)=><p role="alert" key={i} className="text-red-800">{e}</p>)}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="User import rows"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr>{['Row','Email / name','Current role / status','Proposed role / status','Action','Review notes'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{preview.rows.map(r=><tr key={r.row} className="border-t align-top"><td className="p-2">{r.row}</td><td className="p-2 break-all">{r.email}<br/>{r.name}</td><td className="p-2">{r.current ?? 'New user'}</td><td className="p-2">{r.proposed ?? '—'}</td><td className="p-2 font-semibold">{r.action}</td><td className="p-2">{r.messages.map((m,i)=><p key={i} className={r.action==='Error'?'text-red-800':'text-amber-900'}>{m}</p>)}{r.impact.map(i=><p key={i.area}>{i.area}: {i.count} requiring attention</p>)}</td></tr>)}</tbody></table></div>
      {!state.done && !errors && <form action={action} className="space-y-4"><input type="hidden" name="step" value="apply"/><input type="hidden" name="csv" value={state.csv}/><input type="hidden" name="token" value={state.token}/><label className="flex items-start gap-2"><input type="checkbox" name="confirm" value="yes" required disabled={pending}/><span>I reviewed all changes and active work warnings. Historical attribution remains unchanged.</span></label><button className="btn-primary" disabled={pending}>Confirm and import users</button></form>}
      {!!errors && <p>Correct the CSV and upload it again. No changes have been saved.</p>}
    </section>}
  </div>;
}
