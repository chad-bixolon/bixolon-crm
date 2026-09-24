'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { DashboardActionState } from '@/app/dashboard-actions';
import { dashboardItemPresentationSection,dashboardPresentationSectionKeys,dashboardPresentationSectionTitles } from '@/lib/dashboard';
import type { DashboardLayoutConfiguration, DashboardLayoutItem, DashboardPresentationSection, DashboardWidgetKey, DashboardWidgetSize, SavedReportWidgetStyle } from '@/lib/dashboard';

type AvailableWidget={key:DashboardWidgetKey;title:string;description:string;sizes:readonly DashboardWidgetSize[];defaultSize:DashboardWidgetSize;presentationSection:Exclude<DashboardPresentationSection,'PINNED_REPORTS'>};
type AvailableReport={id:number;name:string;reportType:string;grouped:boolean};
type Props={initial:DashboardLayoutConfiguration;widgets:AvailableWidget[];reports?:AvailableReport[];action:(state:DashboardActionState,form:FormData)=>Promise<DashboardActionState>;cancelHref:string;submitLabel:string;allowReports?:boolean};

export function DashboardEditor({initial,widgets,reports=[],action,cancelHref,submitLabel,allowReports=true}:Props){
  const [items,setItems]=useState<DashboardLayoutItem[]>(initial.items),[reportId,setReportId]=useState('');
  const [state,formAction,pending]=useActionState(action,{message:''});
  const definition=(key:DashboardWidgetKey)=>widgets.find(widget=>widget.key===key)!;
  const move=(index:number,offset:number)=>setItems(current=>{const next=[...current],target=index+offset;if(target<0||target>=next.length)return current;[next[index],next[target]]=[next[target],next[index]];return next;});
  const update=(index:number,value:DashboardLayoutItem)=>setItems(current=>current.map((item,itemIndex)=>itemIndex===index?value:item));
  const remove=(index:number)=>setItems(current=>current.filter((_,itemIndex)=>itemIndex!==index));
  const addBuiltin=(key:DashboardWidgetKey)=>{const widget=definition(key);setItems(current=>[...current,{kind:'BUILTIN',key,size:widget.defaultSize}]);};
  const addReport=()=>{const id=Number(reportId),report=reports.find(value=>value.id===id);if(!report||items.some(item=>item.kind==='SAVED_REPORT'&&item.reportId===id))return;setItems(current=>[...current,{kind:'SAVED_REPORT',reportId:id,size:'HALF',style:'KPI'}]);setReportId('');};
  const visibleKeys=new Set(items.filter((item):item is Extract<DashboardLayoutItem,{kind:'BUILTIN'}>=>item.kind==='BUILTIN').map(item=>item.key));
  const availableReports=reports.filter(report=>!items.some(item=>item.kind==='SAVED_REPORT'&&item.reportId===report.id));
  const visibleSections=dashboardPresentationSectionKeys.map(section=>({section,items:items.map((item,index)=>({item,index})).filter(value=>dashboardItemPresentationSection(value.item)===section)})).filter(group=>group.items.length);
  const availableWidgets=widgets.filter(widget=>!visibleKeys.has(widget.key));
  const availableSections=dashboardPresentationSectionKeys.map(section=>({section,widgets:availableWidgets.filter(widget=>widget.presentationSection===section)})).filter(group=>group.widgets.length);
  const itemRow=(item:DashboardLayoutItem,index:number)=>{const report=item.kind==='SAVED_REPORT'?reports.find(value=>value.id===item.reportId):null;const widget=item.kind==='BUILTIN'?definition(item.key):null;const heading=widget?.title??(item.kind==='SAVED_REPORT'?item.title:undefined)??report?.name??'Report unavailable';return <li className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center" key={item.kind==='BUILTIN'?item.key:`report-${item.reportId}`}><div className="min-w-0"><p className="font-medium">{heading}</p><p className="text-xs text-slate-500">{item.kind==='SAVED_REPORT'?`${report?.reportType??'Saved Report'} · Saved Report`:widget?.description}</p></div><div className="flex gap-1"><button className="btn-secondary px-3" type="button" disabled={index===0} onClick={()=>move(index,-1)} aria-label={`Move ${heading} up`}>↑</button><button className="btn-secondary px-3" type="button" disabled={index===items.length-1} onClick={()=>move(index,1)} aria-label={`Move ${heading} down`}>↓</button></div>
    <label className="text-sm">Size<select className="field mt-1 min-w-28" value={item.size} onChange={event=>update(index,{...item,size:event.target.value as DashboardWidgetSize})}>{(widget?.sizes??['HALF','FULL']).map(size=><option key={size} value={size}>{size==='HALF'?'Half':'Full'}</option>)}</select></label>
    {item.kind==='SAVED_REPORT'&&<div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Display<select className="field mt-1" value={item.style} onChange={event=>update(index,{...item,style:event.target.value as SavedReportWidgetStyle})}><option value="KPI">KPI</option><option value="COMPACT_TABLE">Compact Table</option>{report?.grouped&&<option value="GROUPED_SUMMARY">Grouped Summary</option>}</select></label><label className="text-sm">Widget title<input className="field mt-1" maxLength={120} placeholder={report?.name} value={item.title??''} onChange={event=>update(index,{...item,title:event.target.value||undefined})}/></label></div>}
    <button className="text-sm font-semibold text-red-700 underline" type="button" onClick={()=>remove(index)}>Remove</button></li>;};
  return <form action={formAction} className="space-y-5"><input type="hidden" name="configuration" value={JSON.stringify({version:1,items})}/>
    <section className="panel overflow-hidden"><div className="border-b px-4 py-3"><h2 className="font-semibold">Dashboard Sections</h2><p className="text-sm text-slate-600">Choose which items appear, set their order, and select their size.</p></div>
      {items.length?<div>{visibleSections.map(group=><section className="border-b last:border-b-0" key={group.section}><h3 className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{dashboardPresentationSectionTitles[group.section]}</h3><ol className="divide-y">{group.items.map(({item,index})=>itemRow(item,index))}</ol></section>)}</div>:<p className="p-4 text-sm text-slate-500">No widgets selected.</p>}
    </section>
    <section className="panel p-4"><h2 className="font-semibold">Available Widgets</h2>{availableSections.map(group=><div className="mt-3" key={group.section}><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{dashboardPresentationSectionTitles[group.section]}</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{group.widgets.map(widget=><button className="rounded-md border p-3 text-left hover:border-orange-300 hover:bg-orange-50" type="button" key={widget.key} onClick={()=>addBuiltin(widget.key)}><span className="font-medium">+ {widget.title}</span><span className="mt-1 block text-xs text-slate-600">{widget.description}</span></button>)}</div></div>)}{!availableWidgets.length&&<p className="mt-2 text-sm text-slate-500">All available widgets are shown.</p>}</section>
    {allowReports&&<section className="panel p-4"><h2 className="font-semibold">Add Saved Report</h2>{availableReports.length?<div className="mt-3 flex flex-wrap gap-2"><select aria-label="Saved Report" className="field max-w-md" value={reportId} onChange={event=>setReportId(event.target.value)}><option value="">Choose a Saved Report</option>{availableReports.map(report=><option value={report.id} key={report.id}>{report.name} · {report.reportType}</option>)}</select><button className="btn-secondary" type="button" disabled={!reportId} onClick={addReport}>Add Saved Report</button></div>:<p className="mt-2 text-sm text-slate-500">No saved reports are available to add.</p>}</section>}
    {state.message&&<p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{state.message}</p>}
    <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={pending}>{pending?'Saving…':submitLabel}</button><Link className="btn-secondary" href={cancelHref}>Cancel</Link></div>
  </form>;
}
