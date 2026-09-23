'use client';
import {useState,type ReactNode} from 'react';
import {bulkCreateContactsAction} from '@/app/trade-shows/[id]/contact-resolution/actions';

export function ContactResolutionBulkForm({tradeShowId,returnTo='',unresolvedAccounts,excluded,children}:{tradeShowId:number;returnTo?:string;unresolvedAccounts:number;excluded:number;children:ReactNode}){
  const [selected,setSelected]=useState(0),action=bulkCreateContactsAction.bind(null,tradeShowId,returnTo);
  return <form action={action} onChange={event=>setSelected(event.currentTarget.querySelectorAll<HTMLInputElement>('input[name="leadIds"]:checked').length)} onSubmit={event=>{if(!window.confirm(`Create ${selected} Contact${selected===1?'':'s'} with Marketing Preference set to Unknown?`))event.preventDefault();}}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-orange-200 bg-orange-50/60 px-4 py-3 text-sm"><div><strong>{selected} selected</strong><span className="ml-3 text-slate-600">{unresolvedAccounts} eligible lead{unresolvedAccounts===1?' has':'s have'} no resolved Account · {excluded} excluded for duplicate, ambiguous, or incomplete data</span></div><button className="btn-primary" disabled={!selected}>Create Contacts</button></div>
    {children}
  </form>;
}
