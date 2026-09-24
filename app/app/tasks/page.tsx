import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { taskWhere, taskTiming, taskStatuses, taskPriorities, type TaskFilters } from '@/lib/work';
import { workOptions } from '@/lib/work-options';
import { pageNumber } from '@/lib/crm-validation';
import { recordVisibility } from '@/lib/record-visibility';

export const dynamic='force-dynamic';

export default async function Page({searchParams}:{searchParams:Promise<TaskFilters & {page?:string}>}) {
  const f=await searchParams,where=taskWhere(f),count=await prisma.task.count({where});
  const {page,pages}=pageNumber(f.page,count);
  const [tasks,options]=await Promise.all([
    prisma.task.findMany({where,include:{account:true,opportunity:true,assignedTo:true},orderBy:[{dueDate:'asc'},{id:'desc'}],skip:(page-1)*20,take:20}),
    workOptions(),
  ]);
  const linkFor=(target:number)=>{const q=new URLSearchParams();Object.entries(f).forEach(([key,value])=>{if(value&&key!=='page')q.set(key,value);});q.set('page',String(target));return `/tasks?${q}`;};
  const opts=(items:{id:number;name:string}[])=>items.map(x=>({value:String(x.id),label:x.name}));
  const select=(key:keyof TaskFilters,label:string,items:{value:string;label:string}[]) => <label className="label">{label}<select className="field filter-control" name={key} defaultValue={f[key]??''}><option value="">All</option>{items.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>;

  return <Content>
    <PageHeader title="Tasks" eyebrow="CRM records" action={<Link className="btn-primary" href="/tasks/new">New task</Link>}/>
    <form method="get" className="panel filter-panel filter-grid mb-5" aria-label="Filter tasks">
      <label className="label">Search<input className="field filter-control" name="q" defaultValue={f.q??''} placeholder="Subject or description"/></label>
      <label className="label">Visibility<select className="field filter-control" name="visibility" defaultValue={recordVisibility(f.visibility)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label>
      {select('status','Status',taskStatuses.map(x=>({value:x,label:x.replace('_',' ')})))}
      {select('priority','Priority',taskPriorities.map(x=>({value:x,label:x})))}
      {select('assignedToId','Assignee',opts(options.users))}
      {select('accountId','Account',opts(options.accounts))}
      {select('opportunityId','Opportunity',opts(options.opportunities))}
      <label className="label">Due Date From<input className="field filter-control" name="dueFrom" type="date" defaultValue={f.dueFrom??''}/></label>
      <label className="label">Due Date Through<input className="field filter-control" name="dueTo" type="date" defaultValue={f.dueTo??''}/></label>
      <div className="filter-actions"><button className="btn-filter-primary">Apply</button><Link className="btn-filter-secondary" href="/tasks">Clear</Link></div>
    </form>
    <div className="panel overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="border-b bg-slate-50"><tr>{['Task','State','Status','Priority','Assignee','Account','Opportunity','Due'].map(x=><th className="p-3" key={x}>{x}</th>)}</tr></thead><tbody className="divide-y">{tasks.map(t=><tr className="even:bg-slate-50/60 hover:bg-orange-50/50 focus-within:bg-orange-50/50" key={t.id}><td className="p-4"><Link className="text-orange-800" href={`/tasks/${t.id}/edit`}>{t.subject}</Link></td><td className="p-4">{t.archivedAt ? <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">Archived</span> : 'Active'}</td><td className="p-4">{t.status}</td><td className="p-4">{t.priority}</td><td className="p-4">{t.assignedTo?`${t.assignedTo.firstName} ${t.assignedTo.lastName}`:'—'}</td><td className="p-4">{t.account?<Link href={`/accounts/${t.accountId}`} className="text-orange-800">{t.account.name}</Link>:'—'}</td><td className="p-4">{t.opportunity?<Link href={`/opportunities/${t.opportunityId}`} className="text-orange-800">{t.opportunity.name}</Link>:'—'}</td><td className="p-4">{t.dueDate?.toISOString().slice(0,10)??'—'} {!t.archivedAt&&taskTiming(t)&&<strong className="text-red-700">{taskTiming(t)}</strong>}</td></tr>)}</tbody></table>{!tasks.length&&<p className="p-6 text-sm text-slate-500">No tasks match these filters.</p>}</div>
    <div className="mt-4 flex justify-between text-sm"><span>{count} tasks · Page {page} of {pages}</span><div className="flex gap-2">{page>1&&<Link className="btn-secondary" href={linkFor(page-1)}>Previous</Link>}{page<pages&&<Link className="btn-secondary" href={linkFor(page+1)}>Next</Link>}</div></div>
  </Content>;
}
