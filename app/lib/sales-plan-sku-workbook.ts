import * as XLSX from 'xlsx';
import { easternGeneratedAt, moneyFormat, sheet } from './sales-plan-export-workbook';
import type { DetailRow, RollupRow, aggregateSkuLines } from './sales-plan-sku-rollup';
import { allocationPercent } from './sales-plan-sku-rollup';

const n=(value:{toNumber():number}|null)=>value===null?null:value.toNumber();
const amounts=(row:{units:{toNumber():number}|null;revenue:{toNumber():number}|null;quarters:{units:{toNumber():number}|null;revenue:{toNumber():number}|null}[]})=>[n(row.units),n(row.revenue),...row.quarters.flatMap(q=>[n(q.units),n(q.revenue)])];
export function salesPlanSkuWorkbook(rows:RollupRow[],detail:DetailRow[],unresolved:DetailRow[],currencyCode:string,scope:{year:number;rep:string;generatedAt:Date;summary:ReturnType<typeof aggregateSkuLines>['summary']}) {
  const book=XLSX.utils.book_new(),money=moneyFormat(currencyCode),formats:Record<number,string>={2:'#,##0.###',3:money,4:'#,##0.###',5:money,6:'#,##0.###',7:money,8:'#,##0.###',9:money,10:'#,##0.###',11:money};
  const measures=['Annual Units','Annual Revenue',...['Q1','Q2','Q3','Q4'].flatMap(q=>[`${q} Units`,`${q} Revenue`])];
  const rollup=sheet(['Product / Model','Exact SKU',...measures,'Account Count','Rep Count','Plan Lines','Allocated Units','Allocated Revenue','Units Allocation Completion','Revenue Allocation Completion'],rows.map(r=>[r.product,r.sku,...amounts(r),r.accountKeys.size,r.repIds.size,r.lineCount,n(r.allocated.units),n(r.allocated.revenue),allocationPercent(r.units,r.allocated.units)===null?null:allocationPercent(r.units,r.allocated.units)!/100,allocationPercent(r.revenue,r.allocated.revenue)===null?null:allocationPercent(r.revenue,r.allocated.revenue)!/100]),[28,28,...Array(10).fill(19),16,14,14,19,20,24,25],{...formats,15:'#,##0.###',16:money,17:'0.0%',18:'0.0%'},11);
  XLSX.utils.sheet_add_aoa(rollup,[['Plan Year',scope.year],['Currency',currencyCode],['Rep Scope',scope.rep],['Exact SKUs in Plan',scope.summary.skuCount],['Planned Units',n(scope.summary.units)],['Planned Revenue',n(scope.summary.revenue)],['Unresolved SKU Lines',scope.summary.unresolvedLines],['Generated',easternGeneratedAt(scope.generatedAt)]],{origin:'A1'});
  if(rollup.B5?.t==='n')rollup.B5.z='#,##0.###';if(rollup.B6?.t==='n')rollup.B6.z=money;
  XLSX.utils.book_append_sheet(book,rollup,'SKU Rollup');
  const detailHeaders=['Product / Model','Exact SKU','Sales Rep','Account','Plan Item',...measures,'Allocation Status','Comments'];
  const detailRows=(items:DetailRow[])=>items.map(r=>[r.product,r.sku,r.rep,r.account,r.planItem,...amounts(r),r.allocationStatus,r.comments]);
  const detailFormats=Object.fromEntries(Object.entries(formats).map(([k,v])=>[Number(k)+3,v]));
  XLSX.utils.book_append_sheet(book,sheet(detailHeaders,detailRows(detail),[28,27,22,32,32,...Array(10).fill(19),22,55],detailFormats),'Account Rep Detail');
  const unresolvedSheet=sheet(['Sales Rep','Account','Source SKU Text','Plan Item',...measures,'Allocation Status','Comments'],unresolved.map(r=>[r.rep,r.account,r.sku,r.planItem,...amounts(r),r.allocationStatus,r.comments]),[22,32,32,32,...Array(10).fill(19),22,55],Object.fromEntries(Object.entries(formats).map(([k,v])=>[Number(k)+2,v])),3);
  XLSX.utils.sheet_add_aoa(unresolvedSheet,[['These Sales Plan lines are excluded from exact SKU rollup totals until they are resolved to a SalesHub SKU.']],{origin:'A1'});
  XLSX.utils.book_append_sheet(book,unresolvedSheet,'Unresolved SKU Lines');
  return book;
}
