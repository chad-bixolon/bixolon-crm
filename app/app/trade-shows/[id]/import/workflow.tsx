'use client';

import { useState } from 'react';
import { TableScroll } from '@/components/table-scroll';
import { previewTradeShowAction, confirmTradeShowAction } from './actions';
import type { ImportChoice } from '@/lib/trade-show-import';

type Plan = NonNullable<Awaited<ReturnType<typeof previewTradeShowAction>>['plan']>;

function Picker({ value, onChange, items, label }: { value: number | null; onChange: (id: number | null) => void; items: { id: number; name: string }[]; label: string }) {
  const [search, setSearch] = useState('');
  const filtered = search ? items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).slice(0, 30) : items.slice(0, 30);
  const selected = items.find(item => item.id === value);

  return <div className="min-w-0">
    <input aria-label={`Search ${label}`} className="input mb-1 h-8 w-full px-2 py-1 text-xs" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${label}`} />
    <select aria-label={label} className="input h-8 w-full px-2 py-1 text-xs" value={value ?? ''} onChange={event => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">Unresolved</option>
      {selected && !filtered.some(item => item.id === selected.id) && <option value={selected.id}>{selected.name}</option>}
      {filtered.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </div>;
}

function WorkflowSteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Upload', 'Review & Assign', 'Import'];

  return <nav aria-label="Import progress" className="max-w-3xl">
    <ol className="grid grid-cols-3 gap-2">
      {steps.map((step, index) => {
        const number = index + 1;
        const active = number === current;
        const complete = number < current;
        return <li key={step} aria-current={active ? 'step' : undefined} className={`flex min-w-0 items-center gap-2 border-t-2 pt-2 text-xs font-medium sm:text-sm ${active ? 'border-orange-600 text-orange-800' : complete ? 'border-orange-200 text-slate-700' : 'border-slate-200 text-slate-400'}`}>
          <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${active ? 'bg-orange-600 text-white' : complete ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-500'}`}>{number}</span>
          <span className="min-w-0 leading-tight">{step}</span>
        </li>;
      })}
    </ol>
  </nav>;
}

export function TradeShowImportWorkflow({ showId, timezone }: { showId: number; timezone: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof confirmTradeShowAction>>['result']>(null);
  const [defaultRep, setDefaultRep] = useState<number | null>(null);
  const [choices, setChoices] = useState<ImportChoice[]>([]);

  const fileForm = () => {
    const form = new FormData();
    if (file) form.set('file', file);
    return form;
  };

  async function preview() {
    if (!file) return;
    setBusy(true);
    setPreviewing(true);
    setMessage('');
    setResult(null);
    try {
      const response = await previewTradeShowAction(showId, fileForm());
      if (response.error) {
        setPlan(null);
        setMessage(response.error);
      } else if (response.plan) {
        setPlan(response.plan);
        setChoices(response.plan.rows.map(row => ({ sourceKey: row.sourceKey, repId: null, accountId: row.matches.accountSuggestion, contactId: row.matches.contactSuggestion, refresh: false })));
        setDefaultRep(null);
      }
    } finally {
      setPreviewing(false);
      setBusy(false);
    }
  }

  function change(index: number, patch: Partial<ImportChoice>) {
    setChoices(old => old.map((choice, itemIndex) => itemIndex === index ? { ...choice, ...patch } : choice));
  }

  async function confirm() {
    if (!plan || !defaultRep) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await confirmTradeShowAction(showId, fileForm(), plan.parsed.sha256, defaultRep, choices);
      if (response.error) setMessage(response.error);
      else {
        setResult(response.result);
        setPlan(null);
      }
    } finally {
      setBusy(false);
    }
  }

  const repItems = plan?.reps.map(rep => ({ id: rep.id, name: `${rep.firstName} ${rep.lastName}` })) ?? [];
  const accountItems = plan?.accounts.map(account => ({ id: account.id, name: account.name })) ?? [];
  const contactItems = plan?.contacts.map(contact => ({ id: contact.id, name: `${contact.firstName} ${contact.lastName}${contact.email ? ` · ${contact.email}` : ''}${contact.account?.name ? ` · ${contact.account.name}` : ''}` })) ?? [];
  const currentStep: 1 | 2 | 3 = result ? 3 : plan ? 2 : 1;

  return <div className="min-w-0 max-w-full space-y-5">
    <WorkflowSteps current={currentStep} />

    <section className="panel max-w-3xl p-4 sm:p-5">
      <h2 className="text-lg font-semibold">1. Upload and preview</h2>
      <ul id="file-requirements" className="mt-2 flex flex-col gap-1 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:gap-x-5">
        <li>Supported Trade Show exports: NRA/NRF and MODEX/XPressLeads formats (.xls).</li>
        <li>Maximum 2 MB and 1,000 leads.</li>
        <li>Previewing does not change CRM data.</li>
      </ul>
      {!timezone && <p id="timezone-warning" role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <span className="font-semibold">Trade Show timezone is missing.</span> Capture times require review before import.
      </p>}

      <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <label htmlFor="trade-show-workbook" className="relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-orange-600">
          <input
            id="trade-show-workbook"
            className="absolute inset-0 cursor-pointer opacity-0"
            type="file"
            accept=".xls,application/vnd.ms-excel"
            aria-describedby={`file-requirements file-selection-status${!timezone ? ' timezone-warning' : ''}`}
            onChange={event => {
              setFile(event.target.files?.[0] ?? null);
              setPlan(null);
              setResult(null);
            }}
          />
          Choose Excel file
        </label>
        <p id="file-selection-status" aria-live="polite" className={`min-w-0 break-all text-sm ${file ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
          {file?.name ?? 'No file selected'}
        </p>
      </div>

      <button
        className="btn-primary mt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        disabled={!file || busy}
        aria-busy={previewing}
        onClick={() => void preview()}
      >
        {previewing ? 'Generating preview…' : 'Preview workbook'}
      </button>
    </section>

    {message && <p role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">{message}</p>}

    {result && <section className="panel max-w-3xl p-5">
      <h2 className="font-semibold">Import complete</h2>
      <p className="text-sm">{result.created} new · {result.existing} existing · {result.skipped} skipped. <a className="text-orange-800 underline" href={`/trade-shows/${showId}`}>View Trade Show</a></p>
    </section>}

    {plan && <>
      <section className="panel p-5">
        <h2 className="text-lg font-semibold">2. Review &amp; Assign</h2>
        <p className="mt-2 text-sm">{plan.parsed.format} · {plan.filename} · {plan.parsed.sheet}</p>
        {plan.priorExactFile && <p className="mt-2 font-semibold text-amber-800">This exact file has already been confirmed for this Trade Show.</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          {Object.entries(plan.summary).map(([key, value]) => <div className="rounded border px-3 py-2 text-sm" key={key}><strong>{value}</strong> {key.replace(/([A-Z])/g, ' $1').toLowerCase()}</div>)}
        </div>
        <label className="mt-5 block text-sm font-semibold">Default Sales Rep
          <select className="input mt-1 block w-full max-w-sm" value={defaultRep ?? ''} onChange={event => setDefaultRep(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Select active rep</option>
            {repItems.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
          </select>
        </label>
      </section>

      <section className="panel min-w-0 max-w-full">
        <TableScroll label="Trade Show lead preview" topControl bounded>
          <table className="w-[1320px] table-fixed text-left text-sm xl:w-full">
            <colgroup>{[230, 210, 250, 360, 270].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
            <thead className="sticky top-0 z-10 bg-slate-50"><tr>{['Lead', 'Company', 'Contact Info', 'Review', 'Status'].map(heading => <th className="border-b p-2" key={heading}>{heading}</th>)}</tr></thead>
            <tbody className="divide-y">
              {plan.rows.map((row, index) => <tr key={index} className="align-top">
                <td className="p-2"><div className="text-xs text-slate-500">Row {row.sourceRow} · {row.state.replace('_', ' ')}</div><strong className="mt-1 block break-words">{row.firstName} {row.lastName}</strong><div className="line-clamp-3 break-words text-slate-600">{row.title}</div><div className="mt-1 text-xs text-slate-500">{row.capturedAt ?? row.capturedSource ?? 'Capture time needs review'}</div></td>
                <td className="whitespace-pre-wrap break-words p-2">{row.sourceCompany || '—'}{row.sourceNotes&&<details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">Source notes</summary><div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words">{row.sourceNotes}</div></details>}</td>
                <td className="p-2"><div className="break-all">{row.email||'—'}</div><div className="mt-1 break-words text-slate-600">{row.phone||'—'}</div></td>
                <td className="space-y-2 p-2"><div><span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Assigned Rep</span><Picker label="rep" value={choices[index]?.repId ?? null} onChange={id => change(index, { repId: id })} items={repItems} /><span className="mt-1 block text-xs text-slate-500">{choices[index]?.repId ? 'Row override' : `Using default: ${repItems.find(rep => rep.id === defaultRep)?.name ?? 'not selected'}`}</span></div><div><span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Account</span><Picker label="Account" value={choices[index]?.accountId ?? null} onChange={id => change(index, { accountId: id })} items={accountItems} />{row.matches.exactAccounts.length > 0 && <span className="mt-1 block break-words text-xs">Exact: {row.matches.exactAccounts.map(account => account.name).join(', ')}</span>}{row.matches.domainAccounts.length > 0 && <span className="block break-words text-xs">Website: {row.matches.domainAccounts.map(account => account.name).join(', ')}</span>}{row.matches.possibleAccounts.length > 0 && <span className="block break-words text-xs">Possible: {row.matches.possibleAccounts.map(account => account.name).join(', ')}</span>}</div><div><span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Contact</span><Picker label="Contact" value={choices[index]?.contactId ?? null} onChange={id => change(index, { contactId: id })} items={contactItems} />{row.matches.contactMatches.length > 0 && <span className="mt-1 block break-words text-xs">Email: {row.matches.contactMatches.map(contact => `${contact.firstName} ${contact.lastName}${contact.accountId ? ` (#${contact.accountId})` : ''}`).join(', ')}</span>}</div></td>
                <td className="whitespace-normal break-words p-2 text-amber-800"><strong className="block text-xs text-slate-700">{row.state.replace('_',' ')}</strong>{row.warnings.join(' ')}{row.changedSourceFields.map(sourceChange => <div className="mt-2 text-xs" key={sourceChange.header}><strong>{sourceChange.header}:</strong> <span className="line-through">{sourceChange.before || '(blank)'}</span> → {sourceChange.after || '(blank)'}</div>)}{row.state === 'SOURCE_CHANGED' && <label className="mt-2 block text-xs"><input type="checkbox" checked={choices[index]?.refresh ?? false} onChange={event => change(index, { refresh: event.target.checked })} /> Refresh source fields (preserves CRM work)</label>}</td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>
      </section>

      <section className="panel p-5">
        <h2 className="font-semibold">3. Confirm import</h2>
        <p className="mt-1 text-sm text-slate-600">New scans become separate leads. Existing scans stay unchanged unless source refresh is checked. Invalid rows are skipped. Account and Contact records are never edited.</p>
        <button className="btn-primary mt-4" disabled={busy || !defaultRep} onClick={() => void confirm()}>Confirm import</button>
      </section>
    </>}
  </div>;
}
