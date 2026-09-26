'use client';
import { useState } from 'react';
import type { ProductImportItem, ProductImportPlan } from '@/lib/product-import';
import { odmSubtypeLabels } from '@/lib/product-labels';
import { searchProductImportBaseSkus, searchProductImportProducts } from './actions';

const skuKey=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
type ChangeField='modelNames'|'productIds'|'subtypes'|'baseSkus';
type Props={plan:ProductImportPlan;selected:string[];busy:boolean;dirty:boolean;onSelect:(keys:string[])=>void;onChange:(field:ChangeField,keys:string[],value:string)=>Promise<void>;onCreate:()=>Promise<void>};

export function CatalogBatchReview({plan,selected,busy,dirty,onSelect,onChange,onCreate}:Props) {
  const [nameDrafts,setNameDrafts]=useState<Record<string,string>>({});
  const [productSearch,setProductSearch]=useState<Record<string,{id:number;name:string}[]>>({});
  const [baseSearch,setBaseSearch]=useState<Record<string,{partNumber:string;product:{name:string}}[]>>({});
  const candidates=plan.items.filter(item=>item.catalogCreatable&&item.reviewKey);
  const skuGroups=new Map<string,ProductImportItem[]>();
  for(const item of candidates) {const key=skuKey(item.after.partNumber);skuGroups.set(key,[...(skuGroups.get(key)??[]),item]);}
  const productGroups=new Map<string,ProductImportItem[]>();
  for(const items of skuGroups.values()) {const item=items[0],key=item.productId?`id:${item.productId}`:`new:${item.after.model.trim().toLowerCase()}`;productGroups.set(key,[...(productGroups.get(key)??[]),...items]);}
  const keys=(items:ProductImportItem[])=>items.map(item=>item.reviewKey!).filter(Boolean);
  const toggle=(items:ProductImportItem[],checked:boolean)=>onSelect(checked?[...new Set([...selected,...keys(items)])]:selected.filter(key=>!keys(items).includes(key)));
  const affected=(items:ProductImportItem[])=>new Set(items.map(item=>`${item.source?.sheet??''}:${item.line}`)).size;
  const selectedSkus=[...skuGroups.values()].filter(items=>items.some(item=>selected.includes(item.reviewKey!))).length;
  const selectedProducts=[...productGroups.values()].filter(items=>!items[0].productId&&items.some(item=>selected.includes(item.reviewKey!))).length;
  return <section className="panel p-6">
    <h2 className="text-lg font-semibold">Catalog batch creation</h2>
    <p className="mt-2 text-sm text-slate-600">{[...productGroups.values()].filter(items=>!items[0].productId).length} proposed Products · {skuGroups.size} safe SKUs. Review assignments and confirm creation. Pricing is saved only at final import.</p>
    <div className="mt-3 flex gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>onSelect(keys(candidates))}>Select all safe</button><button className="btn-secondary" disabled={busy} onClick={()=>onSelect([])}>Deselect all</button></div>
    <div className="mt-4 space-y-5">{[...productGroups.entries()].map(([groupKey,items])=>{
      const first=items[0],groupKeys=keys(items),productName=first.after.model,search=productSearch[groupKey]??[];
      const groupedSkus=[...skuGroups.entries()].filter(([,skuItems])=>items.includes(skuItems[0]));
      return <div className="rounded border border-slate-300 p-4" key={groupKey}>
        <div className="flex flex-wrap items-start gap-4"><label className="flex items-center gap-2 font-semibold"><input type="checkbox" aria-label={`Select Product ${productName}`} checked={groupKeys.every(key=>selected.includes(key))} onChange={event=>toggle(items,event.target.checked)}/>{productName}</label><span className="text-sm">Category: {first.after.category||'Unassigned'} · ODM: {first.after.catalogSource==='ODM'?'Yes':'No'} · Existing Product: {first.productId?`#${first.productId}`:'None'} · {affected(items)} workbook rows</span></div>
        <p className="mt-1 text-sm">Source SKUs: {[...new Set(items.map(item=>item.after.partNumber))].join(', ')}</p>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <label>Proposed Product name<input className="field mt-1 w-full" maxLength={200} value={nameDrafts[groupKey]??productName} onChange={event=>setNameDrafts(current=>({...current,[groupKey]:event.target.value}))} onBlur={()=>{const name=nameDrafts[groupKey];if(name&&name.trim()!==productName)void onChange('modelNames',groupKeys,name.trim());}}/></label>
          <div><label>Use existing Product<input className="field mt-1 w-full" placeholder="Search Product name" onChange={event=>void searchProductImportProducts(event.target.value).then(found=>setProductSearch(current=>({...current,[groupKey]:found})))}/></label><select className="field mt-1 w-full" aria-label={`Existing Product for ${productName}`} value={first.productId??''} onChange={event=>void onChange('productIds',groupKeys,event.target.value)}><option value="">Create proposed Product</option>{first.productId&&<option value={first.productId}>{productName} (#{first.productId})</option>}{search.filter(candidate=>candidate.id!==first.productId).map(candidate=><option value={candidate.id} key={candidate.id}>{candidate.name} (#{candidate.id})</option>)}</select></div>
        </div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr><th className="p-2">Create</th><th className="p-2">SKU</th><th className="p-2">Product</th><th className="p-2">ODM subtype</th><th className="p-2">Base SKU</th><th className="p-2">Source customer</th><th className="p-2">Pricing rows</th></tr></thead><tbody>{groupedSkus.map(([sku,skuItems])=>{const item=skuItems[0],skuKeys=keys(skuItems);return <tr className="border-t align-top" key={sku}><td className="p-2"><input type="checkbox" aria-label={`Create ${sku}`} checked={skuKeys.some(key=>selected.includes(key))} onChange={event=>toggle(skuItems,event.target.checked)}/></td><td className="p-2 font-medium">{item.after.partNumber}</td><td className="p-2">{item.after.model}</td><td className="p-2"><select className="field min-w-40" aria-label={`ODM subtype for ${sku}`} value={item.after.odmSubtype??''} onChange={event=>void onChange('subtypes',skuKeys,event.target.value)}>{Object.entries(odmSubtypeLabels).filter(([value])=>value!=='LEGACY_SPECIAL_SKU').map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></td><td className="p-2"><input className="field min-w-36" list={`batch-bases-${sku}`} aria-label={`Base SKU for ${sku}`} defaultValue={item.after.baseSku??''} placeholder="Optional" onChange={event=>void searchProductImportBaseSkus(event.target.value).then(found=>setBaseSearch(current=>({...current,[sku]:found})))} onBlur={event=>{if(event.target.value!==item.after.baseSku)void onChange('baseSkus',skuKeys,event.target.value);}}/><datalist id={`batch-bases-${sku}`}>{(baseSearch[sku]??[]).map(base=><option key={base.partNumber} value={base.partNumber}>{base.product.name}</option>)}</datalist></td><td className="p-2">{[...new Set(skuItems.map(entry=>entry.source?.customerCell).filter(Boolean))].join(', ')||'—'}</td><td className="p-2">{affected(skuItems)}</td></tr>;})}</tbody></table></div>
      </div>;
    })}</div>
    <button className="btn-primary mt-4" disabled={busy||dirty||!selectedSkus} onClick={()=>void onCreate()}>Review and create {selectedProducts} Products and {selectedSkus} SKUs</button>
  </section>;
}
