import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { ContactAccountFilter } from "@/components/contact-account-filter";
import { contactListState, contactListUrl, listContacts, marketingPreferenceLabels, type ContactFilters, type ContactSort } from "@/lib/contacts";
import { prisma } from "@/lib/prisma";
import { positiveId } from "@/lib/crm-validation";
import { currentUser } from "@/lib/current-user";
import { can } from "@/lib/authorization";
export const dynamic = "force-dynamic";
const keys = ["q","active","accountId","marketingPreference","title","primary","assignment","sort","dir","pageSize"] as const;
export default async function ContactsPage({searchParams}:{searchParams:Promise<ContactFilters>}) {
  const actor = await currentUser();
  const filters=await searchParams, accountId=positiveId(filters.accountId??"");
  const [{contacts,count,page,pages,pageSize},initialAccount]=await Promise.all([listContacts(prisma,filters),accountId?prisma.account.findUnique({where:{id:accountId},select:{id:true,name:true}}):Promise.resolve(null)]);
  const {sort,dir}=contactListState(filters);
  const hasFilters=["q","active","accountId","marketingPreference","title","primary","assignment"].some(key=>Boolean(filters[key as keyof ContactFilters]));
  const header=(key:ContactSort,label:string)=>{
    const next=sort!==key?{sort:key,dir:"asc"}:dir==="asc"?{sort:key,dir:"desc"}:{sort:undefined,dir:undefined};
    const direction=sort===key?dir:key==="name"&&!sort?"asc":null;
    return <Link href={contactListUrl(filters,next)} className="inline-flex items-center gap-1 hover:text-orange-800" aria-label={`Sort by ${label}${direction?`, currently ${direction}ending`:""}`}><span>{label}</span><span className="text-[10px] text-slate-400" aria-hidden="true">{direction==="asc"?"▲":direction==="desc"?"▼":"↕"}</span></Link>;
  };
  return <Content>
    <PageHeader eyebrow="CRM records" title="Contacts" description="Manage customer, partner, and prospect contacts." action={can(actor, 'contacts.write') && <Link className="btn-primary" href="/contacts/new">New contact</Link>}/>
    <form method="get" className="panel filter-panel filter-grid mb-5" aria-label="Filter contacts">
      <input type="hidden" name="sort" value={filters.sort??""}/><input type="hidden" name="dir" value={filters.dir??""}/><input type="hidden" name="pageSize" value={pageSize}/>
      <div><label className="label" htmlFor="q">Search</label><input className="field filter-control" id="q" name="q" defaultValue={filters.q??""} placeholder="Name, email, or title"/></div>
      <div><label className="label" htmlFor="active">Status</label><select className="field filter-control" id="active" name="active" defaultValue={filters.active??""}><option value="">Not Archived</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option><option value="all">All</option></select></div>
      <ContactAccountFilter key={filters.accountId??""} initial={initialAccount} unassigned={filters.accountId==="unassigned"}/>
      <div><label className="label" htmlFor="marketingPreference">Marketing communications</label><select className="field filter-control" id="marketingPreference" name="marketingPreference" defaultValue={filters.marketingPreference??""}><option value="">All preferences</option><option value="UNKNOWN">Not specified</option><option value="OPTED_IN">Opted in</option><option value="OPTED_OUT">Opted out</option></select></div>
      <details className="col-span-full" open={Boolean(filters.title||filters.primary||filters.assignment)}><summary className="cursor-pointer text-sm font-medium text-orange-800">More filters</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><label className="label" htmlFor="title">Title contains</label><input className="field filter-control" id="title" name="title" defaultValue={filters.title??""}/></div>
        <div><label className="label" htmlFor="primary">Primary contact</label><select className="field filter-control" id="primary" name="primary" defaultValue={filters.primary??""}><option value="">Any</option><option value="yes">Primary only</option><option value="no">Not primary</option></select></div>
        <div><label className="label" htmlFor="assignment">Account assignment</label><select className="field filter-control" id="assignment" name="assignment" defaultValue={filters.assignment??""}><option value="">Any</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select></div>
      </div></details>
      <div className="filter-actions"><button className="btn-filter-primary">Apply</button><Link className="btn-filter-secondary" href="/contacts">Clear</Link></div>
    </form>
    <div className="panel overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>{(["name","account","title","email","status"] as const).map(key=><th className="px-5 py-4" key={key} aria-sort={(sort===key||!sort&&key==="name")?(dir==="desc"?"descending":"ascending"):"none"}>{header(key,key[0].toUpperCase()+key.slice(1))}</th>)}</tr></thead><tbody className="divide-y">{contacts.map(c=><tr className="odd:bg-white even:bg-slate-50/60 hover:bg-orange-50/50" key={c.id}><td className="px-5 py-4"><Link className="font-semibold text-orange-800" href={`/contacts/${c.id}`}>{c.firstName} {c.lastName}</Link>{c.isPrimary&&<span className="ml-2 text-xs text-slate-500">Primary</span>}</td><td className="px-5 py-4">{c.account?<Link className="text-orange-800" href={`/accounts/${c.accountId}`}>{c.account.name}</Link>:"Unassigned"}</td><td className="px-5 py-4">{c.title??"—"}</td><td className="px-5 py-4">{c.email??"—"}</td><td className="px-5 py-4"><div>{c.archivedAt?"Archived":c.active?"Active":"Inactive"}</div><span className={`mt-1 inline-flex rounded px-2 py-0.5 text-xs font-medium ${c.marketingPreference==="OPTED_IN"?"bg-emerald-50 text-emerald-800":c.marketingPreference==="OPTED_OUT"?"bg-rose-50 text-rose-800":"bg-slate-100 text-slate-600"}`}>{marketingPreferenceLabels[c.marketingPreference]}</span></td></tr>)}</tbody></table>{contacts.length===0&&<div className="p-8 text-center text-sm text-slate-500"><p>No contacts match these filters.</p>{hasFilters&&<Link className="mt-2 inline-block text-orange-800 underline" href="/contacts">Clear filters</Link>}</div>}</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><span>{count?`${(page-1)*pageSize+1}–${Math.min(page*pageSize,count)}`:"0"} of {count} contact{count===1?"":"s"}</span><div className="flex items-center gap-3"><form method="get" className="flex items-center gap-2">{keys.filter(key=>key!=="pageSize").map(key=>filters[key]?<input key={key} type="hidden" name={key} value={filters[key]}/>:null)}<label htmlFor="pageSize">Per page</label><select className="field h-9" id="pageSize" name="pageSize" defaultValue={pageSize}>{[25,50,100].map(size=><option key={size} value={size}>{size}</option>)}</select><button type="submit" className="btn-secondary">Apply</button></form><span>Page {page} of {pages}</span>{page>1&&<Link className="btn-secondary" href={contactListUrl(filters,{page:String(page-1)})}>Previous</Link>}{page<pages&&<Link className="btn-secondary" href={contactListUrl(filters,{page:String(page+1)})}>Next</Link>}</div></div>
  </Content>;
}
