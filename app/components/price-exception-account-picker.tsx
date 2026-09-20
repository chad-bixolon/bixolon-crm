'use client';
import { useEffect, useId, useState } from 'react';

export type PriceExceptionAccountOption = { id:number; name:string; status:string; archivedAt:string|null };
export function PriceExceptionAccountPicker({name,label,initial,error}:{name:string;label:string;initial:PriceExceptionAccountOption|null;error?:string}){
  const uid=useId();
  const [selected,setSelected]=useState(initial);
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<PriceExceptionAccountOption[]>([]);
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState(false);
  const [active,setActive]=useState(0);
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      setLoading(true);
      fetch(`/price-exceptions/account-search?q=${encodeURIComponent(query)}`,{signal:controller.signal})
        .then(response=>response.ok?response.json():{accounts:[]})
        .then(data=>{setResults(data.accounts??[]);setActive(0)}).catch(()=>{})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    },200);
    return()=>{clearTimeout(timer);controller.abort()};
  },[open,query]);
  const choose=(account:PriceExceptionAccountOption)=>{setSelected(account);setQuery('');setOpen(false);setEditing(false)};
  return <div className="relative">
    <input type="hidden" name={name} value={selected?.id??''}/>
    <label className="label" htmlFor={`${uid}-search`}>{label}</label>
    {selected&&!editing?<div className="mt-1 flex min-h-10 items-center justify-between gap-3 rounded border border-slate-300 bg-white px-3 py-2 text-sm"><span><strong>{selected.name}</strong>{(selected.status!=='ACTIVE'||selected.archivedAt)&&<span className="ml-2 text-xs text-slate-500">Historical / inactive</span>}</span><span className="flex gap-3"><button className="text-orange-800 underline" type="button" onClick={()=>{setEditing(true);setOpen(true)}}>Change</button><button className="text-slate-600 underline" type="button" onClick={()=>{setSelected(null);setOpen(false)}}>Clear</button></span></div>:<div className="mt-1 flex gap-2"><input id={`${uid}-search`} className="field" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${uid}-results`} aria-activedescendant={open&&results[active]?`${uid}-option-${active}`:undefined} placeholder="Search existing active Accounts" value={query} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setOpen(true)}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setActive(value=>Math.min(value+1,Math.max(0,results.length-1)))}if(event.key==='ArrowUp'){event.preventDefault();setActive(value=>Math.max(value-1,0))}if(event.key==='Enter'&&open&&results[active]){event.preventDefault();choose(results[active])}if(event.key==='Escape')setOpen(false)}} onBlur={()=>setTimeout(()=>setOpen(false),100)}/>{editing&&<button className="btn-secondary" type="button" onClick={()=>{setEditing(false);setOpen(false);setQuery('')}}>Cancel</button>}</div>}
    {open&&(!selected||editing)&&<div id={`${uid}-results`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded border border-slate-300 bg-white shadow-lg">{results.map((account,index)=><button type="button" role="option" aria-selected={index===active} id={`${uid}-option-${index}`} key={account.id} className={`block w-full px-3 py-2 text-left text-sm ${index===active?'bg-orange-50':'hover:bg-slate-50'}`} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(account)}>{account.name}</button>)}{loading&&<p className="p-3 text-sm text-slate-500" role="status">Searching…</p>}{!loading&&!results.length&&<p className="p-3 text-sm text-slate-500">No active Accounts found.</p>}</div>}
    {error&&<p className="mt-1 text-sm text-red-700">{error}</p>}
  </div>;
}
