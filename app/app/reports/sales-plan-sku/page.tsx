import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { activeSalesRepWhere } from '@/lib/assignment-eligibility';
import { formatPlanCurrency, formatPlanNumber, formatPlanPercent } from '@/lib/display-format';
import { allocationPercent, rollupAccess, salesPlanSkuRollup, skuContributions } from '@/lib/sales-plan-sku-rollup';

export const dynamic='force-dynamic';
type Params={year?:string;currencyCode?:string;userId?:string;productId?:string;skuId?:string;accountId?:string;search?:string;detailSkuId?:string};
const id=(s?:string)=>s&&/^\d+$/.test(s)&&Number.isSafeInteger(Number(s))&&Number(s)>0?Number(s):null;
const shown=(v:{toString():string}|null,code?:string)=>v===null?'—':code?formatPlanCurrency(v,code):formatPlanNumber(v);
export default async function Page({searchParams}:{searchParams:Promise<Params>}) {
  const actor=await currentUser();if(!rollupAccess(actor))return <Content>Access denied.</Content>;
  const raw=await searchParams,nowYear=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric'}).format(new Date()));
  const year=/^\d{4}$/.test(raw.year??'')&&Number(raw.year)>=2000&&Number(raw.year)<=2100?Number(raw.year):nowYear;
  const currencyCode=/^[A-Z]{3}$/.test(raw.currencyCode??'')?raw.currencyCode!:'USD';
  const selection={year,currencyCode,userId:id(raw.userId),productId:id(raw.productId),skuId:id(raw.skuId),accountId:id(raw.accountId),search:(raw.search??'').slice(0,100)};
  const planWhere={planYear:year,currencyCode,status:'ACTIVE' as const,owner:activeSalesRepWhere()};
  const [report,reps,currencies,skus,accounts]=await Promise.all([
    salesPlanSkuRollup(prisma,actor,selection),
    prisma.user.findMany({where:activeSalesRepWhere(),select:{id:true,firstName:true,lastName:true},orderBy:[{lastName:'asc'},{firstName:'asc'}]}),
    prisma.currency.findMany({where:{active:true},select:{code:true},orderBy:{code:'asc'}}),
    prisma.productSku.findMany({where:{salesPlanLines:{some:{plan:planWhere}}},select:{id:true,partNumber:true,productId:true,product:{select:{name:true}}},orderBy:{partNumber:'asc'}}),
    prisma.account.findMany({where:{salesPlanLines:{some:{plan:planWhere}}},select:{id:true,name:true},orderBy:{name:'asc'}}),
  ]);
  const {rows,lines,unresolved,summary}=report;
  const detailId=id(raw.detailSkuId),selected=rows.find(r=>r.skuId===detailId);
  const contributions=selected?skuContributions(lines,selected.skuId):[];
  const params=new URLSearchParams(Object.entries(selection).filter(([,v])=>v!==null&&v!=='').map(([k,v])=>[k,String(v)]));
  const exportHref=`/reports/sales-plan-sku/export?${params.toString()}`;
  const detailHref=(skuId:number)=>`/reports/sales-plan-sku?${params.toString()}&detailSkuId=${skuId}#sku-detail`;
  const completion=(annual:Prisma.Decimal|null,allocated:Prisma.Decimal|null)=>{const p=allocationPercent(annual,allocated);return p===null?'—':formatPlanPercent(p);};
  return <Content><PageHeader eyebrow="Reports / Sales Plan" title="Sales Plan SKU Rollup" description="Approved Sales Plan demand by exact SKU. Quarterly values reflect rep-entered allocation, not actual orders, shipments, revenue, or inventory." action={<div className="page-header-actions"><Link className="btn-primary" href={exportHref}>Export Excel</Link><Link className="btn-secondary" href="/reports/sales-plan">Sales Plan report</Link></div>}/>
    <form method="get" className="panel filter-panel filter-grid filter-row mb-5">
      <label className="label">Plan Year<input className="field filter-control" name="year" type="number" min="2000" max="2100" defaultValue={year}/></label>
      <label className="label">Currency<select className="field filter-control" name="currencyCode" defaultValue={currencyCode}>{currencies.map(c=><option key={c.code} value={c.code}>{c.code}</option>)}</select></label>
      <label className="label">Sales Rep<select className="field filter-control" name="userId" defaultValue={selection.userId??''}><option value="">All planned reps</option>{reps.map(r=><option key={r.id} value={r.id}>{r.firstName} {r.lastName}</option>)}</select></label>
      <label className="label">Product / Model<select className="field filter-control" name="productId" defaultValue={selection.productId??''}><option value="">All products</option>{[...new Map(skus.map(s=>[s.productId,s.product])).entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([id,p])=><option key={id} value={id}>{p.name}</option>)}</select></label>
      <label className="label">Exact SKU<select className="field filter-control" name="skuId" defaultValue={selection.skuId??''}><option value="">All SKUs</option>{skus.map(s=><option key={s.id} value={s.id}>{s.partNumber}</option>)}</select></label>
      <label className="label">Account<select className="field filter-control" name="accountId" defaultValue={selection.accountId??''}><option value="">All Accounts</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="label">Search<input className="field filter-control" name="search" maxLength={100} defaultValue={selection.search} placeholder="SKU, Account, Plan Item"/></label>
      <div className="filter-actions"><button className="btn-primary w-full sm:w-auto">View report</button></div>
    </form>
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[['Exact SKUs in Plan',String(summary.skuCount)],['Planned Units',shown(summary.units)],['Planned Revenue',shown(summary.revenue,currencyCode)],['Accounts',String(summary.accountCount)],['Unresolved SKU Lines',String(summary.unresolvedLines)],['Quarterly Allocation',`${completion(summary.units,summary.allocated.units)} units / ${completion(summary.revenue,summary.allocated.revenue)} revenue`]].map(([label,value])=><div key={label} className="panel p-3"><div className="text-xs text-slate-600">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div></div>)}</section>
    <p className="mb-3 text-sm text-slate-600">{summary.exactLines} exact SKU plan lines. A dash means no value was entered; zero is an entered value. Allocation completion compares allocated amounts with annual amounts.</p>
    <section className="panel overflow-x-auto p-4"><h2 className="mb-3 text-lg font-semibold">Exact SKU demand</h2><table className="w-full min-w-[1700px] text-sm"><thead><tr>{['Product / Model','Exact SKU','Annual Units','Annual Revenue',...['Q1','Q2','Q3','Q4'].flatMap(q=>[`${q} Units`,`${q} Revenue`]),'Accounts','Reps','Plan Lines','Allocation Completion'].map(x=><th className="p-2 text-left" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r=><tr className="border-t" key={r.skuId}><td className="p-2">{r.product}</td><td className="p-2"><Link className="text-orange-800 underline" href={detailHref(r.skuId)}>{r.sku}</Link></td><td className="p-2">{shown(r.units)}</td><td className="p-2">{shown(r.revenue,currencyCode)}</td>{r.quarters.flatMap((q,i)=>[<td className="p-2" key={`${i}-u`}>{shown(q.units)}</td>,<td className="p-2" key={`${i}-r`}>{shown(q.revenue,currencyCode)}</td>])}<td className="p-2">{r.accountKeys.size}</td><td className="p-2">{r.repIds.size}</td><td className="p-2">{r.lineCount}</td><td className="p-2">{completion(r.units,r.allocated.units)} units / {completion(r.revenue,r.allocated.revenue)} revenue</td></tr>)}</tbody></table>{!rows.length&&<p className="p-3 text-slate-600">No resolved SKU lines for this selection.</p>}</section>
    {selected&&<section className="panel mt-5 overflow-x-auto p-4" id="sku-detail"><h2 className="mb-1 text-lg font-semibold">{selected.sku} · Account / rep contribution</h2><p className="mb-3 text-sm text-slate-600">Rows combine approved lines for the same Account and rep.</p><table className="w-full min-w-[1500px] text-sm"><thead><tr>{['Account','Sales Rep','Plan Item','Annual Units','Annual Revenue',...['Q1','Q2','Q3','Q4'].flatMap(q=>[`${q} Units`,`${q} Revenue`]),'Plan Lines'].map(x=><th className="p-2 text-left" key={x}>{x}</th>)}</tr></thead><tbody>{contributions.map(l=><tr className="border-t" key={l.id}><td className="p-2">{l.account}</td><td className="p-2">{l.rep}</td><td className="p-2">{l.planItem}</td><td className="p-2">{shown(l.units)}</td><td className="p-2">{shown(l.revenue,currencyCode)}</td>{l.quarters.flatMap((q,i)=>[<td className="p-2" key={`${i}-u`}>{shown(q.units)}</td>,<td className="p-2" key={`${i}-r`}>{shown(q.revenue,currencyCode)}</td>])}<td className="p-2">{l.lineCount}</td></tr>)}</tbody></table></section>}
    <section className="panel mt-5 overflow-x-auto p-4"><h2 className="text-lg font-semibold">Unresolved SKU plan lines ({unresolved.length})</h2><p className="mb-3 text-sm text-slate-600">Source SKU text has no ProductSku match. These lines are excluded from exact SKU totals. Review them in the existing Sales Plan workflow.</p><table className="w-full min-w-[900px] text-sm"><thead><tr>{['Sales Rep','Account','Source SKU Text','Plan Item','Annual Units','Annual Revenue','Comments'].map(x=><th className="p-2 text-left" key={x}>{x}</th>)}</tr></thead><tbody>{unresolved.map(l=><tr className="border-t" key={l.id}><td className="p-2"><Link className="text-orange-800 underline" href={`/reports/sales-plan?year=${year}&currencyCode=${currencyCode}&userId=${l.ownerId}`}>{l.rep}</Link></td><td className="p-2">{l.account}</td><td className="p-2">{l.sku}</td><td className="p-2">{l.planItem}</td><td className="p-2">{shown(l.units)}</td><td className="p-2">{shown(l.revenue,currencyCode)}</td><td className="p-2">{l.comments}</td></tr>)}</tbody></table>{!unresolved.length&&<p className="p-3 text-slate-600">No unresolved SKU lines for this selection.</p>}</section>
  </Content>;
}
