'use client';
import { RecoverableActionForm } from './recoverable-action-form';
import { recoverUnavailableOwner } from '@/app/administration/ownership/actions';

export function UnavailableRecoveryForm({ type, id, editToken, choices }: { type: string; id: number; editToken: string; choices: { id: number; name: string }[] }) {
  return <RecoverableActionForm action={recoverUnavailableOwner} refreshOnSuccess className="flex min-w-44 flex-wrap items-center gap-2" onSubmitCapture={event => {
    const form = event.currentTarget;
    const selected = (form.elements.namedItem('replacement') as HTMLSelectElement)?.selectedOptions[0]?.textContent;
    if (!selected || !window.confirm(`Assign this ${type} to ${selected}?`)) event.preventDefault();
  }}>
    <input type="hidden" name="type" value={type}/><input type="hidden" name="id" value={id}/><input type="hidden" name="editToken" value={editToken}/>
    <label className="sr-only" htmlFor={`recover-${type}-${id}`}>Replacement user</label>
    <select className="field max-w-56" name="replacement" id={`recover-${type}-${id}`} defaultValue="" required><option value="" disabled>Choose replacement</option>{choices.map(choice => <option value={choice.id} key={choice.id}>{choice.name}</option>)}</select>
    <button className="btn-secondary">Assign</button>
  </RecoverableActionForm>;
}
