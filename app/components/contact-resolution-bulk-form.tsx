'use client';
import {startTransition,useRef,useState,type ReactNode} from 'react';
import {bulkCreateContactsAction} from '@/app/trade-shows/[id]/contact-resolution/actions';

export function ContactResolutionBulkForm({tradeShowId,returnTo='',unresolvedAccounts,excluded,children}:{tradeShowId:number;returnTo?:string;unresolvedAccounts:number;excluded:number;children:ReactNode}){
  const [selected,setSelected]=useState(0),[pending,setPending]=useState(false),[error,setError]=useState(''),busy=useRef(false),action=bulkCreateContactsAction.bind(null,tradeShowId,returnTo);
  return <form onChange={event=>setSelected(event.currentTarget.querySelectorAll<HTMLInputElement>('input[name="leadIds"]:checked').length)} onSubmit={event=>{event.preventDefault();if(busy.current||!window.confirm(`Create ${selected} Contact${selected===1?'':'s'} with Marketing Preference set to Unknown?`))return;const data=new FormData(event.currentTarget);busy.current=true;setPending(true);setError('');startTransition(async()=>{try{const result=await action(data);if(result?.error)setError(result.error)}catch{setError('Contacts could not be created. Please try again.')}finally{busy.current=false;setPending(false)}})}}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-orange-200 bg-orange-50/60 px-4 py-3 text-sm"><div><strong>{selected} selected</strong><span className="ml-3 text-slate-600">{unresolvedAccounts} eligible lead{unresolvedAccounts===1?' has':'s have'} no resolved Account · {excluded} excluded for duplicate, ambiguous, or incomplete data</span></div><button className="btn-primary" disabled={!selected||pending}>{pending?'Creating…':'Create Contacts'}</button>{error&&<p role="alert" className="w-full text-red-700">{error}</p>}</div>
    {children}
  </form>;
}
