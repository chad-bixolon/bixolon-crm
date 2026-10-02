'use client';
import { useState } from 'react';
import { allocateAction } from './actions';
import { splitEvenly } from '@/lib/sales-plan-allocation';

const quarters=['Q1','Q2','Q3','Q4'] as const;
type Values={units:string;revenue:string};
export function AllocationEditor({lineId,units,revenue,initial}:{lineId:number;units:string|null;revenue:string|null;initial:Record<string,Values>}){
  const [open,setOpen]=useState(false);
  const [values,setValues]=useState<Record<string,Values>>(()=>Object.fromEntries(quarters.map(q=>[q,initial[q]??{units:'',revenue:''}])));
  const hasAllocation=quarters.some(q=>values[q].units!==''||values[q].revenue!=='');
  const change=(q:string,key:keyof Values,value:string)=>setValues(current=>({...current,[q]:{...current[q],[key]:value}}));
  const split=()=>{const unitParts=units===null?null:splitEvenly(units,3),revenueParts=revenue===null?null:splitEvenly(revenue,2);setValues(Object.fromEntries(quarters.map((q,i)=>[q,{units:unitParts?.[i]??'',revenue:revenueParts?.[i]??''}])));};
  const clear=()=>setValues(Object.fromEntries(quarters.map(q=>[q,{units:'',revenue:''}])));
  return <div className="mt-3"><button type="button" className="btn-secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>{hasAllocation?'Edit quarterly allocation':'Allocate by quarter'}</button>{open&&<form action={allocateAction} className="mt-3 overflow-x-auto rounded border p-3"><input type="hidden" name="lineId" value={lineId}/><div className="grid min-w-[600px] grid-cols-[100px_repeat(4,minmax(95px,1fr))_120px] gap-2 text-sm"><span></span>{quarters.map(q=><strong key={q}>{q}</strong>)}<strong>Total</strong>{(['units','revenue'] as const).map(key=><div className="contents" key={key}><span className="self-center">{key==='units'?'Units':'Revenue'}</span>{quarters.map(q=><input key={q} className="field min-w-0" aria-label={`${q} ${key}`} name={`${q}${key==='units'?'Units':'Revenue'}`} type="number" min="0" step={key==='units'?'0.001':'0.01'} value={values[q][key]} disabled={(key==='units'?units:revenue)===null} onChange={e=>change(q,key,e.target.value)}/>)}<span className="self-center">{key==='units'?`${sum(values,'units',3)} / ${units??'—'}`:`${sum(values,'revenue',2)} / ${revenue??'—'}`}</span></div>)}</div><p className="mt-2 text-xs text-slate-600">Totals show allocated / official annual baseline. Partial and overallocated entries can be saved.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={split}>Split evenly</button><button type="button" className="btn-secondary" onClick={clear}>Clear allocation</button><button className="btn-primary">Save Allocation</button></div></form>}</div>;
}
function sum(values:Record<string,Values>,key:keyof Values,places:number){const scale=BigInt(10)**BigInt(places);const total=quarters.reduce((acc,q)=>{const value=values[q][key];if(!/^\d+(?:\.\d+)?$/.test(value))return acc;const [whole,fraction='']=value.split('.');if(fraction.length>places)return acc;return acc+BigInt(whole)*scale+BigInt(fraction.padEnd(places,'0'));},BigInt(0));return `${total/scale}.${String(total%scale).padStart(places,'0')}`;}
