const quarters=['Q1','Q2','Q3','Q4'] as const;
import { formatPlanNumber } from './display-format';

export function normalizeAllocationInput(raw:string):string {
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$/.test(raw) ? raw.replace(/,/g,'') : raw;
}

export function formatAllocationInput(raw:string,measure:'units'|'revenue'):string {
  const normalized=normalizeAllocationInput(raw);
  if(!/^\d+(?:\.\d+)?$/.test(normalized))return raw;
  const [whole,fraction='']=normalized.split('.');
  const digits=fraction.replace(/0+$/,'');
  return `${formatPlanNumber(whole)}${digits?`.${measure==='revenue'?digits.padEnd(2,'0'):digits}`:''}`;
}

export function sumAllocation(values:Record<string,{units:string;revenue:string}>,key:'units'|'revenue',places:number):string {
  const scale=BigInt(10)**BigInt(places);
  const total=quarters.reduce((acc,q)=>{const value=normalizeAllocationInput(values[q][key]);if(!/^\d+(?:\.\d+)?$/.test(value))return acc;const [whole,fraction='']=value.split('.');if(fraction.length>places)return acc;return acc+BigInt(whole)*scale+BigInt(fraction.padEnd(places,'0'));},BigInt(0));
  return `${total/scale}.${String(total%scale).padStart(places,'0')}`;
}
export function splitEvenly(value:string,places:number):string[]{
  if(!/^\d+(?:\.\d+)?$/.test(value)) return quarters.map(()=>'');
  const [whole,fraction='']=value.split('.');
  if(fraction.length>places)return quarters.map(()=>'');
  const scale=BigInt(10)**BigInt(places),amount=BigInt(whole)*scale+BigInt(fraction.padEnd(places,'0'));
  const base=amount/BigInt(4),remainder=amount%BigInt(4);
  return quarters.map((_,i)=>{const part=base+(BigInt(i)<remainder?BigInt(1):BigInt(0));return places?`${part/scale}.${String(part%scale).padStart(places,'0')}`:part.toString();});
}
