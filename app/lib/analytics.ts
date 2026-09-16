import { Prisma, type Opportunity, type OpportunityProduct, type SalesStage } from '@prisma/client';
import { opportunityTotal, weightedValue } from './opportunities';
type Row = Pick<Opportunity,'id'|'currencyCode'|'probability'|'expectedCloseDate'|'forecastCategory'> & { stage: Pick<SalesStage,'id'|'name'|'probability'>; products: Pick<OpportunityProduct,'quantity'|'estimatedUnitPrice'|'archivedAt'>[] };
export function summarizePipeline(rows: Row[], key: (row: Row) => string) {
  const groups = new Map<string,{count:number;estimated:Prisma.Decimal;weighted:Prisma.Decimal}>();
  for (const row of rows) { const label=key(row); const old=groups.get(label)??{count:0,estimated:new Prisma.Decimal(0),weighted:new Prisma.Decimal(0)}; const estimated=opportunityTotal(row.products); old.count++; old.estimated=old.estimated.add(estimated); old.weighted=old.weighted.add(weightedValue(estimated,row.probability??row.stage.probability)); groups.set(label,old); }
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([label,value])=>({label,...value}));
}
export const closeMonth = (row: Row) => row.expectedCloseDate?.toISOString().slice(0,7)??'Unscheduled';
export function pipelineTotalsByCurrency(rows: Row[]) {
  const currencies = [...new Set(rows.map(row => row.currencyCode))].sort();
  return currencies.map(currency => {
    const group = summarizePipeline(rows.filter(row => row.currencyCode === currency), () => currency)[0];
    return { currency, count: group.count, estimated: group.estimated, weighted: group.weighted };
  });
}
