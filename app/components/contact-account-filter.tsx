"use client";
import { useEffect, useId, useState } from "react";

type Account = { id: number; name: string };
export function ContactAccountFilter({ initial, unassigned }: { initial: Account | null; unassigned: boolean }) {
  const uid = useId();
  const [selected, setSelected] = useState<Account | null>(initial);
  const [withoutAccount, setWithoutAccount] = useState(unassigned);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/contacts/account-search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : { accounts: [] })
        .then(data => { setResults(data.accounts ?? []); setActive(0); })
        .catch(() => {});
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query]);
  const choose = (account: Account) => { setSelected(account); setWithoutAccount(false); setQuery(""); setOpen(false); };
  return <div className="relative min-w-0">
    <label className="label" htmlFor={`${uid}-search`}>Account</label>
    <input type="hidden" name="accountId" value={withoutAccount ? "unassigned" : selected?.id ?? ""}/>
    {selected || withoutAccount ? <div className="filter-control flex items-center justify-between gap-2 rounded border border-slate-300 bg-white"><span className="truncate">{withoutAccount ? "Unassigned" : selected?.name}</span><button type="button" className="text-orange-800 underline" onClick={() => { setSelected(null); setWithoutAccount(false); }}>Clear</button></div> : <input id={`${uid}-search`} className="field filter-control" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${uid}-results`} aria-activedescendant={open && results[active] ? `${uid}-option-${active}` : undefined} value={query} placeholder="All accounts · search" onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setActive(value => Math.min(value + 1, Math.max(0, results.length - 1))); } if (event.key === "ArrowUp") { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); } if (event.key === "Enter" && open && results[active]) { event.preventDefault(); choose(results[active]); } if (event.key === "Escape") setOpen(false); }} onBlur={() => setTimeout(() => setOpen(false), 100)}/>}
    {open && !selected && !withoutAccount && <div id={`${uid}-results`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded border border-slate-300 bg-white shadow-lg"><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-orange-50" onMouseDown={event => event.preventDefault()} onClick={() => { setWithoutAccount(true); setOpen(false); }}>Unassigned</button>{results.map((account, index) => <button type="button" role="option" aria-selected={index === active} id={`${uid}-option-${index}`} key={account.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-orange-50" onMouseDown={event => event.preventDefault()} onClick={() => choose(account)}>{account.name}</button>)}</div>}
  </div>;
}
