'use client';
import { useState } from 'react';
import { allocateAction } from './actions';
import { formatAllocationInput, normalizeAllocationInput, splitEvenly, sumAllocation } from '@/lib/sales-plan-allocation';
import { formatPlanCurrency, formatPlanNumber } from '@/lib/display-format';

const quarters=['Q1','Q2','Q3','Q4'] as const;
type Values={units:string;revenue:string};
export function AllocationEditor({lineId,units,revenue,currencyCode,initial}:{lineId:number;units:string|null;revenue:string|null;currencyCode:string;initial:Record<string,Values>}){
  const [open,setOpen]=useState(false);
  const [values,setValues]=useState<Record<string,Values>>(()=>Object.fromEntries(quarters.map(q=>[q,{units:formatAllocationInput(initial[q]?.units??'','units'),revenue:formatAllocationInput(initial[q]?.revenue??'','revenue')}])));
  const hasAllocation=quarters.some(q=>values[q].units!==''||values[q].revenue!=='');
  const change=(q:string,key:keyof Values,value:string)=>setValues(current=>({...current,[q]:{...current[q],[key]:value}}));
  const split=()=>{const unitParts=units===null?null:splitEvenly(units,3),revenueParts=revenue===null?null:splitEvenly(revenue,2);setValues(Object.fromEntries(quarters.map((q,i)=>[q,{units:formatAllocationInput(unitParts?.[i]??'','units'),revenue:formatAllocationInput(revenueParts?.[i]??'','revenue')}])));};
  const clear=()=>setValues(Object.fromEntries(quarters.map(q=>[q,{units:'',revenue:''}])));
  const total=(key:keyof Values)=>key==='units'?formatPlanNumber(sumAllocation(values,key,3)):formatPlanCurrency(sumAllocation(values,key,2),currencyCode);
  const baseline=(key:keyof Values)=>{const value=key==='units'?units:revenue;return value===null?'—':key==='units'?formatPlanNumber(value):formatPlanCurrency(value,currencyCode);};
  return <div className="mt-3"><button type="button" className="btn-secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>{hasAllocation?'Edit quarterly allocation':'Allocate by quarter'}</button>{open&&<form action={allocateAction} className="mt-3 overflow-x-auto rounded border p-3"><input type="hidden" name="lineId" value={lineId}/><div className="grid min-w-[780px] grid-cols-[80px_repeat(4,minmax(120px,1fr))_minmax(170px,auto)] gap-2 text-sm"><span></span>{quarters.map(q=><strong key={q}>{q}</strong>)}<strong>Total</strong>{(['units','revenue'] as const).map(key=><div className="contents" key={key}><span className="self-center">{key==='units'?'Units':'Revenue'}</span>{quarters.map(q=><div key={q} className="min-w-0"><input className="field min-w-0 w-full" aria-label={`${q} ${key}`} type="text" inputMode="decimal" value={values[q][key]} disabled={(key==='units'?units:revenue)===null} onChange={e=>change(q,key,e.target.value)} onBlur={()=>change(q,key,formatAllocationInput(values[q][key],key))}/><input type="hidden" name={`${q}${key==='units'?'Units':'Revenue'}`} value={normalizeAllocationInput(values[q][key])} disabled={(key==='units'?units:revenue)===null}/></div>)}<span className="self-center whitespace-nowrap tabular-nums" aria-label={`${key} allocated and annual baseline`}>{total(key)} / {baseline(key)}</span></div>)}</div><p className="mt-2 text-xs text-slate-600">Totals show allocated / official annual baseline. Partial and overallocated entries can be saved.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={split}>Split evenly</button><button type="button" className="btn-secondary" onClick={clear}>Clear allocation</button><button className="btn-primary">Save Allocation</button></div></form>}</div>;
}
