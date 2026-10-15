'use client';

import { createContext, useContext, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { changeTasks } from '@/app/tasks/bulk-actions';
import { changeCases } from '@/app/support/cases/bulk-actions';
import { BULK_SELECTION_LIMIT, type BulkRecord } from '@/lib/bulk-action-contract';

type Action = { value: string; label: string };
type Selection = { ids: number[]; eligible: number[]; busy: boolean; toggle: (id: number) => void; all: () => void };
const Context = createContext<Selection | null>(null);
const taskActions: Action[] = [{ value: 'assign', label: 'Assign' }, { value: 'dueDate', label: 'Change due date' }, { value: 'complete', label: 'Mark complete' }];
const caseActions: Action[] = [{ value: 'assign', label: 'Assign' }, { value: 'priority', label: 'Change priority' }];
const priorities = [{ value: 'LOW', label: 'Low' }, { value: 'NORMAL', label: 'Normal' }, { value: 'HIGH', label: 'High' }, { value: 'CRITICAL', label: 'Critical' }];

export function BulkSelection({ kind, records, assignees, enabled, children }: {
  kind: 'tasks' | 'cases'; records: BulkRecord[]; assignees: { id: number; name: string }[]; enabled: boolean; children: ReactNode;
}) {
  const [selected, setSelected] = useState<BulkRecord[]>([]), [action, setAction] = useState<Action | null>(null);
  const [review, setReview] = useState<BulkRecord[]>([]);
  const [value, setValue] = useState(''), [submitting, setSubmitting] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [refreshing, startTransition] = useTransition();
  const busy = submitting || refreshing;
  const dialog = useRef<HTMLDialogElement>(null), gate = useRef(false), trigger = useRef<HTMLButtonElement | null>(null);
  const targetId = useId();
  const eligible = records.slice(0, BULK_SELECTION_LIMIT);
  const current = selected.filter(row => eligible.some(record => record.id === row.id && record.updatedAt === row.updatedAt));
  const ids = current.map(row => row.id);
  const toggle = (id: number) => { if (busy) return; setMessage(''); setSelected(ids.includes(id) ? current.filter(row => row.id !== id) : [...current, ...eligible.filter(row => row.id === id)]); };
  const all = () => { if (!busy) { setMessage(''); setSelected(ids.length === eligible.length ? [] : eligible); } };
  const close = () => { if (gate.current || busy) return; dialog.current?.close(); setAction(null); trigger.current?.focus(); };
  const target = action?.value === 'assign' ? assignees.find(row => String(row.id) === value)?.name : action?.value === 'priority' ? priorities.find(row => row.value === value)?.label : value;
  const summary = action?.value === 'complete' ? `Mark ${review.length} selected Tasks complete.` : action?.value === 'assign' ? `Assign ${review.length} selected ${kind === 'tasks' ? 'Tasks' : 'Cases'} to ${target || 'the chosen assignee'}.` : action?.value === 'dueDate' ? `Change the due date of ${review.length} selected Tasks to ${target || 'the chosen date'}.` : `Change the priority of ${review.length} selected Cases to ${target || 'the chosen priority'}.`;
  return <Context.Provider value={enabled ? { ids, eligible: eligible.map(row => row.id), busy, toggle, all } : null}>
    {enabled && <>
      {ids.length > 0 && <div className="panel mb-3 flex flex-wrap items-center gap-2 p-3 text-sm" aria-label="Bulk actions">
        <strong aria-live="polite">{ids.length} selected</strong><span className="text-slate-600">on this page · limit {BULK_SELECTION_LIMIT}</span>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setSelected([]); setMessage(''); }}>Clear selection</button>
        {(kind === 'tasks' ? taskActions : caseActions).map(item => <button key={item.value} type="button" className="btn-secondary" disabled={busy} onClick={event => { trigger.current = event.currentTarget; setAction(item); setReview(current); setValue(''); setError(''); dialog.current?.showModal(); }}>{item.label}</button>)}
      </div>}
      {message && <p role="status" className="mb-3 text-sm text-emerald-800">{message}</p>}
      <dialog ref={dialog} className="bulk-confirm-dialog saved-views-dialog" aria-label="Confirm bulk update" onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),button:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          if (gate.current || !action || !review.length) return;
          gate.current = true; setSubmitting(true); setError('');
          const request = { records: review, action: action.value, value, confirmed: true };
          startTransition(async () => {
          try {
            const result = await (kind === 'tasks' ? changeTasks(request) : changeCases(request));
            if (result.ok) {
              dialog.current?.close(); setAction(null); setSelected([]);
              setMessage(`${result.count} ${kind === 'tasks' ? 'Tasks' : 'Cases'} updated.`);
            } else setError(result.message);
          } catch { setError('The result could not be confirmed. Refresh the list before retrying.'); }
          finally { gate.current = false; setSubmitting(false); }
          });
        }}>
          <h2 className="text-lg font-semibold">Confirm bulk update</h2>
          <p className="break-words text-sm">{summary}</p>
          {action?.value === 'assign' && <div><label className="label" htmlFor={targetId}>{kind === 'tasks' ? 'Assignee' : 'Support Rep'}</label><select id={targetId} className="field" required value={value} disabled={busy} onChange={event => setValue(event.target.value)}><option value="">Choose…</option>{assignees.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div>}
          {action?.value === 'dueDate' && <div><label className="label" htmlFor={targetId}>Due date</label><input id={targetId} className="field" type="date" required value={value} disabled={busy} onChange={event => setValue(event.target.value)}/></div>}
          {action?.value === 'priority' && <div><label className="label" htmlFor={targetId}>Priority</label><select id={targetId} className="field" required value={value} disabled={busy} onChange={event => setValue(event.target.value)}><option value="">Choose…</option>{priorities.map(row => <option key={row.value} value={row.value}>{row.label}</option>)}</select></div>}
          <p className="text-sm text-slate-600">Every selected record must pass validation. If any record fails, none will change.</p>
          {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
          <div className="form-action-row"><button type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="btn-primary" disabled={busy || !review.length || (action?.value !== 'complete' && !value)}>{busy ? 'Updating…' : `Confirm ${review.length} updates`}</button></div>
        </form>
      </dialog>
    </>}
    {children}
  </Context.Provider>;
}

export function BulkCheckbox({ id, label }: { id: number; label: string }) {
  const selection = useContext(Context);
  if (!selection || !selection.eligible.includes(id)) return null;
  return <label className="inline-flex min-h-11 min-w-11 items-center justify-center"><input type="checkbox" className="h-4 w-4 accent-orange-700" aria-label={`Select ${label}`} checked={selection.ids.includes(id)} disabled={selection.busy} onChange={() => selection.toggle(id)}/></label>;
}

export function BulkPageCheckbox() {
  const selection = useContext(Context);
  if (!selection) return null;
  const all = !!selection.eligible.length && selection.ids.length === selection.eligible.length;
  return <label className="inline-flex min-h-11 items-center gap-2 text-xs font-medium normal-case"><input type="checkbox" className="h-4 w-4 accent-orange-700" aria-label="Select eligible records on this page" ref={node => { if (node) node.indeterminate = selection.ids.length > 0 && !all; }} checked={all} disabled={selection.busy || !selection.eligible.length} onChange={selection.all}/><span>Select page</span></label>;
}
