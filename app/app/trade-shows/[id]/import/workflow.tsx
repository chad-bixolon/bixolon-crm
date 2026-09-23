'use client';

import { useState } from 'react';
import { TableScroll } from '@/components/table-scroll';
import { previewTradeShowAction, previewMappedTradeShowAction, confirmTradeShowAction } from './actions';
import type { ImportChoice } from '@/lib/trade-show-import';
import { MAPPING_DESTINATIONS, type MappingDefinition, type MappingDestination } from '@/lib/trade-show-import-fields';
import type { TradeShowImportFormat } from '@prisma/client';

type Plan = NonNullable<Awaited<ReturnType<typeof previewTradeShowAction>>['plan']>;
type MappingRequest = NonNullable<Awaited<ReturnType<typeof previewTradeShowAction>>['mappingRequired']>;

function Picker({ value, onChange, items, label, emptyLabel = 'Not linked' }: { value: number | null; onChange: (id: number | null) => void; items: { id: number; name: string }[]; label: string; emptyLabel?: string }) {
  const [search, setSearch] = useState('');
  const filtered = search ? items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).slice(0, 30) : items.slice(0, 30);
  const selected = items.find(item => item.id === value);

  return <div className="min-w-0">
    <input aria-label={`Search ${label}`} className="field mb-1 h-8 min-w-0 px-2 py-1 text-xs" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${label}`} />
    <select aria-label={label} className="field h-8 min-w-0 px-2 py-1 text-xs" value={value ?? ''} onChange={event => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">{emptyLabel}</option>
      {selected && !filtered.some(item => item.id === selected.id) && <option value={selected.id}>{selected.name}</option>}
      {filtered.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </div>;
}

const summaryMetrics = [
  ['total', 'Total'],
  ['new', 'New'],
  ['needsReview', 'Needs Review'],
  ['alreadyImported', 'Already Imported'],
  ['changedSource', 'Changed Source'],
  ['invalid', 'Invalid'],
  ['usableEmail', 'Usable Email'],
  ['duplicateEmailGroups', 'Duplicate Email Groups'],
  ['fallbackIdentityRows', 'Fallback Identity Rows'],
  ['fallbackCollisionGroups', 'Fallback Identity Collisions'],
  ['unresolvedAccounts', 'Accounts Not Linked'],
  ['unresolvedContacts', 'Contacts Not Linked'],
  ['placeholderRows', 'Placeholder Rows'],
] as const;

const sourceFormatLabels: Record<TradeShowImportFormat, string> = { NRA_NRF: 'NRA / NRF', XPRESSLEADS_MODEX: 'MODEX / XPressLeads', CUSTOM_MAPPING: 'Custom column mapping' };

const rowStateLabel = (state: string) => state.split('_').map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(' ');
const rowWarnings = (warnings: string[]) => warnings.filter(warning => warning !== 'Trade Show timezone is missing.');

function WorkflowSteps({ current, mapping }: { current: number; mapping: boolean }) {
  const steps = mapping ? ['Upload', 'Map Columns', 'Preview / Review & Assign', 'Import'] : ['Upload', 'Review & Assign', 'Import'];

  return <nav aria-label="Import progress" className="max-w-3xl">
    <ol className={`grid ${mapping?'grid-cols-4':'grid-cols-3'} gap-2`}>
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
  const [mappingRequired, setMappingRequired] = useState<MappingRequest | null>(null);
  const [mappingDefinition, setMappingDefinition] = useState<MappingDefinition | null>(null);
  const [saveMapping, setSaveMapping] = useState(false);
  const [mappingName, setMappingName] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof confirmTradeShowAction>>['result']>(null);
  const [defaultRep, setDefaultRep] = useState<number | null>(null);
  const [choices, setChoices] = useState<ImportChoice[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [repOverrideRow, setRepOverrideRow] = useState<number | null>(null);

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
        setMappingRequired(null);
        setMessage(response.error);
      } else if (response.plan) {
        setPlan(response.plan);
        setMappingRequired(null);
        setChoices(response.plan.rows.map(row => ({ sourceKey: row.sourceKey, repId: null, accountId: row.matches.accountSuggestion, contactId: row.matches.contactSuggestion, refresh: false })));
        setDefaultRep(null);
        setExpandedRow(null);
        setRepOverrideRow(null);
      } else if(response.mappingRequired){
        setPlan(null);
        setMappingRequired(response.mappingRequired);
        setMappingDefinition(response.mappingRequired.definition);
        setSaveMapping(false);
        setMappingName(response.mappingRequired.suggested?.name ?? '');
      }
    } finally {
      setPreviewing(false);
      setBusy(false);
    }
  }

  function mapColumn(sourceHeader:string,destination:MappingDestination|null){
    setMappingDefinition(old=>old?{...old,columns:old.columns.map(column=>column.sourceHeader===sourceHeader?{...column,destination}:column)}:old);
  }

  async function mappedPreview(){
    if(!file||!mappingDefinition)return;setBusy(true);setPreviewing(true);setMessage('');
    try{const response=await previewMappedTradeShowAction(showId,fileForm(),mappingDefinition,saveMapping?mappingName:null);if(response.error)setMessage(response.error);else if(response.plan){setPlan(response.plan);setMappingRequired(null);setChoices(response.plan.rows.map(row=>({sourceKey:row.sourceKey,repId:null,accountId:row.matches.accountSuggestion,contactId:row.matches.contactSuggestion,refresh:false})));setDefaultRep(null);setExpandedRow(null);setRepOverrideRow(null);}}
    finally{setPreviewing(false);setBusy(false);}
  }

  function change(index: number, patch: Partial<ImportChoice>) {
    setChoices(old => old.map((choice, itemIndex) => itemIndex === index ? { ...choice, ...patch } : choice));
  }

  async function confirm() {
    if (!plan || !defaultRep) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await confirmTradeShowAction(showId, fileForm(), plan.parsed.sha256, defaultRep, choices, plan.mapping);
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
  const mappingFlow=!!mappingRequired||plan?.parsed.format==='CUSTOM_MAPPING';
  const currentStep = result ? (mappingFlow?4:3) : plan ? (mappingFlow?3:2) : mappingRequired ? 2 : 1;

  return <div className="min-w-0 max-w-full space-y-5">
    <WorkflowSteps current={currentStep} mapping={mappingFlow} />

    <section className="panel max-w-3xl p-4 sm:p-5">
      <h2 className="text-lg font-semibold">1. Upload</h2>
      <ul id="file-requirements" className="mt-2 flex flex-col gap-1 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:gap-x-5">
        <li>Trade Show lead exports only (.xls or .xlsx); known formats map automatically.</li>
        <li>Maximum 2 MB and 1,000 leads.</li>
        <li>Previewing does not change CRM data.</li>
      </ul>
      {!timezone && <p id="timezone-warning" role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <span className="font-semibold">Trade Show timezone is missing.</span> Capture times require review before import.
      </p>}

      <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <label htmlFor="trade-show-workbook" className="btn-secondary relative cursor-pointer overflow-hidden focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-orange-600">
          <input
            id="trade-show-workbook"
            className="absolute inset-0 cursor-pointer opacity-0"
            type="file"
            accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-describedby={`file-requirements file-selection-status${!timezone ? ' timezone-warning' : ''}`}
            onChange={event => {
              setFile(event.target.files?.[0] ?? null);
              setPlan(null);
              setMappingRequired(null);
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
        {previewing ? 'Reading workbook…' : 'Continue'}
      </button>
    </section>

    {message && <p role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">{message}</p>}

    {result && <section className="panel max-w-3xl p-5">
      <h2 className="font-semibold">Import Complete</h2>
      <p className="text-sm">{result.created} new · {result.existing} existing · {result.skipped} skipped. <a className="text-orange-800 underline" href={`/trade-shows/${showId}`}>View Trade Show</a></p>
    </section>}

    {mappingRequired&&mappingDefinition&&<section className="panel min-w-0 max-w-5xl p-5">
      <h2 className="text-lg font-semibold">Column Mapping Required</h2>
      <p className="mt-1 text-sm text-slate-600">{mappingRequired.helper}</p>
      <p className="mt-2 text-xs text-slate-500">First worksheet: {mappingRequired.sheet} · {mappingRequired.columns.length} source columns · 2–3 nonblank samples shown per column.</p>
      {mappingRequired.suggested&&<p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Suggested saved mapping: <strong>{mappingRequired.suggested.name}</strong>. Headers changed, so review is required before continuing.</p>}
      <div className="mt-4 min-w-0 max-w-full"><TableScroll label="Trade Show column mapping" bounded><table className="w-full min-w-[700px] table-fixed text-left text-sm"><colgroup><col className="w-1/4"/><col className="w-2/5"/><col className="w-[35%]"/></colgroup><thead className="bg-slate-50"><tr>{['Source Column','Sample Data','SalesHub Field'].map(label=><th className="border-b p-2" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{mappingRequired.columns.map(column=>{const selected=mappingDefinition.columns.find(item=>item.sourceHeader===column.header)?.destination??null;return <tr className="align-top" key={column.header}><td className="break-words p-2 font-medium">{column.header}</td><td className="p-2 text-xs text-slate-600">{column.samples.length?column.samples.map((sample,index)=><div className="max-h-16 overflow-hidden whitespace-pre-wrap break-words" key={index}>{sample}</div>):<span className="italic">No nonblank samples</span>}</td><td className="p-2"><select className="field h-9 w-full min-w-0 px-2 py-1 text-sm" aria-label={`SalesHub field for ${column.header}`} value={selected??''} onChange={event=>mapColumn(column.header,(event.target.value||null) as MappingDestination|null)}><option value="">Preserve as source data only</option>{MAPPING_DESTINATIONS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>{selected==='sourceLeadId'&&<span className="mt-1 block text-xs text-amber-800">Optional stable attendee/scan ID only. Do not use booth staff, app user, badge/operator, or access-code fields unless they truly identify the lead scan.</span>}</td></tr>})}</tbody></table></TableScroll></div>
      <p className="mt-4 text-sm text-slate-600"><strong>Required:</strong> First Name, Last Name, Company, and at least one of Email or Phone. Captured Date / Time is preferred; a deliberately mapped Source Lead / Scan ID is the next strongest identity. Without either, re-import matching uses normalized attendee fields. Every unmapped column is retained in raw source data.</p>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={saveMapping} onChange={event=>setSaveMapping(event.target.checked)}/> Save this mapping for future imports</label>
      {saveMapping&&<label className="mt-2 block max-w-sm text-sm font-semibold">Mapping name<input className="field mt-1 block w-full" maxLength={100} value={mappingName} onChange={event=>setMappingName(event.target.value)} placeholder="FSTEC Lead Export"/></label>}
      <button className="btn-primary mt-4" disabled={busy||!mappingDefinition||saveMapping&&!mappingName.trim()} onClick={()=>void mappedPreview()}>{previewing?'Generating preview…':'Preview Leads'}</button>
    </section>}

    {plan && <>
      <section className="panel p-5">
        <h2 className="text-lg font-semibold">{mappingFlow?'3':'2'}. Review &amp; Assign</h2>
        <p className="mt-2 break-words text-sm">{sourceFormatLabels[plan.parsed.format]} · <span className="break-all">{plan.filename}</span> · {plan.parsed.sheet}</p>
        {plan.mapping?.name&&<p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">Saved mapping detected: <strong>{plan.mapping.name}</strong></p>}
        {plan.priorExactFile && <p className="mt-2 font-semibold text-amber-800">This exact file has already been confirmed for this Trade Show.</p>}
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Import summary">
          {summaryMetrics.map(([key, label], index) => <div className={index < 3 ? 'rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-slate-800' : 'rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600'} key={key}><strong className={index < 3 ? 'text-base text-slate-950' : 'text-sm text-slate-800'}>{plan.summary[key]}</strong> {label}</div>)}
        </div>
        <label className="mt-5 block text-sm font-semibold">Default Sales Rep
          <select className="field mt-1 block h-11 w-full max-w-sm" value={defaultRep ?? ''} onChange={event => setDefaultRep(event.target.value ? Number(event.target.value) : null)}>
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
              {plan.rows.map((row, index) => {
                const choice = choices[index];
                const expanded = expandedRow === index;
                const overrideRep = repItems.find(rep => rep.id === choice?.repId);
                const assignedRep = overrideRep ?? repItems.find(rep => rep.id === defaultRep);
                const account = accountItems.find(item => item.id === choice?.accountId);
                const contact = plan.contacts.find(item => item.id === choice?.contactId);
                const warnings = rowWarnings(row.warnings);
                const hasStatusIssue = warnings.length > 0 || row.state !== 'NEW';
                return <tr key={`${row.sourceKey}-${index}`} className={`align-top ${expanded ? 'bg-orange-50/30' : ''}`}>
                  <td className="p-2"><div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span>Row {row.sourceRow}</span>{row.state === 'NEW' && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">New</span>}{row.identityStrategy==='ATTENDEE_FIELDS'&&<span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Fallback identity</span>}{row.identityStrategy==='SOURCE_LEAD_ID'&&<span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-800">Source ID identity</span>}</div><strong className="block break-words leading-5">{row.firstName} {row.lastName}</strong>{row.title && <div className="line-clamp-1 break-words leading-5 text-slate-600">{row.title}</div>}<div className="truncate text-xs leading-5 text-slate-500" title={row.capturedAt ?? row.capturedSource ?? 'No captured time'}>{row.capturedAt ?? row.capturedSource ?? 'No captured time'}</div></td>
                  <td className="whitespace-pre-wrap break-words p-2 leading-5"><div className="line-clamp-3">{row.sourceCompany || '—'}</div>{row.sourceNotes&&<details className="text-xs text-slate-600"><summary className="cursor-pointer">Source notes</summary><div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words">{row.sourceNotes}</div></details>}</td>
                  <td className="p-2 leading-5"><div className="line-clamp-2 break-all">{row.email||'—'}</div>{row.phone && <div className="break-words text-slate-600">{row.phone}</div>}</td>
                  <td className="p-2">
                    {!expanded ? <div className="space-y-1 text-xs leading-5">
                      <div className="min-w-0"><span className="font-semibold text-slate-600">Assigned Rep</span> <span className="break-words text-slate-900">{assignedRep?.name ?? 'Not selected'}</span> <span className="text-slate-500">· {overrideRep ? 'Override' : 'Default'}</span></div>
                      <div><span className="font-semibold text-slate-600">Account</span> <span className={account ? 'text-slate-900' : 'text-amber-700'}>{account?.name ?? 'Not linked'}</span></div>
                      <div><span className="font-semibold text-slate-600">Contact</span> <span className={contact ? 'text-slate-900' : 'text-amber-700'}>{contact ? `${contact.firstName} ${contact.lastName}` : 'Not linked'}</span></div>
                      <button className="font-semibold text-orange-800 underline underline-offset-2" type="button" aria-expanded="false" onClick={() => { setExpandedRow(index); setRepOverrideRow(choice?.repId ? index : null); }}>Review</button>
                    </div> : <div className="space-y-3">
                      <div><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold uppercase text-slate-500">Assigned Rep</span><span className="text-xs text-slate-500">{choice?.repId ? 'Override' : 'Default'}</span></div>
                        {repOverrideRow === index || choice?.repId ? <Picker label="rep override" value={choice?.repId ?? null} onChange={id => change(index, { repId: id })} items={repItems} emptyLabel="Use default rep" /> : <div className="mt-0.5 text-sm"><span className="break-words">{assignedRep?.name ?? 'Not selected'}</span><button className="ml-2 text-xs font-semibold text-orange-800 underline underline-offset-2" type="button" onClick={() => setRepOverrideRow(index)}>Override rep</button></div>}
                      </div>
                      <div><span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Account</span><Picker label="Account" value={choice?.accountId ?? null} onChange={id => change(index, { accountId: id })} items={accountItems} />{row.matches.exactAccounts.length > 0 && <span className="mt-1 block break-words text-xs">Exact: {row.matches.exactAccounts.map(item => item.name).join(', ')}</span>}{row.matches.domainAccounts.length > 0 && <span className="block break-words text-xs">Website: {row.matches.domainAccounts.map(item => item.name).join(', ')}</span>}{row.matches.possibleAccounts.length > 0 && <span className="block break-words text-xs">Possible: {row.matches.possibleAccounts.map(item => item.name).join(', ')}</span>}</div>
                      <div><span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Contact</span><Picker label="Contact" value={choice?.contactId ?? null} onChange={id => change(index, { contactId: id })} items={contactItems} />{row.matches.contactMatches.length > 0 && <span className="mt-1 block break-words text-xs">Email: {row.matches.contactMatches.map(item => `${item.firstName} ${item.lastName}${item.accountId ? ` (#${item.accountId})` : ''}`).join(', ')}</span>}</div>
                      <button className="text-xs font-semibold text-orange-800 underline underline-offset-2" type="button" aria-expanded="true" onClick={() => { setExpandedRow(null); setRepOverrideRow(null); }}>Done</button>
                    </div>}
                  </td>
                  <td className="whitespace-normal break-words p-2 text-amber-800">{hasStatusIssue ? <>{row.state !== 'NEW' && <strong className={`block text-xs ${row.state === 'INVALID' ? 'text-red-700' : 'text-slate-700'}`}>{rowStateLabel(row.state)}</strong>}{warnings.map(warning => <div className="text-xs leading-5" key={warning}>{warning}</div>)}</> : <span className="text-xs text-slate-500">Ready</span>}{row.changedSourceFields.map(sourceChange => <div className="mt-2 text-xs" key={sourceChange.header}><strong>{sourceChange.header}:</strong> <span className="line-through">{sourceChange.before || '(blank)'}</span> → {sourceChange.after || '(blank)'}</div>)}{row.state === 'SOURCE_CHANGED' && <label className="mt-2 block text-xs"><input type="checkbox" checked={choice?.refresh ?? false} onChange={event => change(index, { refresh: event.target.checked })} /> Refresh source fields (preserves CRM work)</label>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </TableScroll>
      </section>

      <section className="panel p-5">
        <h2 className="font-semibold">{mappingFlow?'4':'3'}. Confirm Import</h2>
        <p className="mt-1 text-sm text-slate-600">New scans become separate leads. Existing scans stay unchanged unless source refresh is checked. Invalid rows are skipped. Account and Contact records are never edited.</p>
        <button className="btn-primary mt-4" disabled={busy || !defaultRep} onClick={() => void confirm()}>Confirm Import</button>
      </section>
    </>}
  </div>;
}
