"use client";
import { useEffect, useId, useState } from "react";
import { formatCurrency } from "@/lib/display-format";
import { odmCustomerWarning, pricesForCurrency, selectCatalogItem, selectedProductFitsCategory, type CatalogItem } from "@/lib/catalog-picker";
import type { ProductPriceTier } from "@prisma/client";

type PricingChange = { priceSource: "MANUAL" | "CATALOG" | "PRICE_EXCEPTION"; catalogPriceTier: ProductPriceTier | null; priceExceptionLineId: number | null; priceExceptionCode: string | null; priceExceptionUnitPrice: string | null; priceExceptionCurrencyCode: string | null; priceExceptionSourceQty: string | null; priceExceptionAccountIds: number[] };
type Candidate = { lineId: number; priceExceptionId: number; peCode: string | null; unitPrice: string; currencyCode: string; moq: string | null; moqRaw: string | null; expirationDate: string | null; comments: string | null; parties: { role: string; accountId: number | null; accountName: string | null; sourceName: string | null; matchesOpportunity: boolean }[]; matchedRoles: string[] };
type Props = { index: number; productId: number; skuId: number; categories: { id: number; name: string }[]; currencyCode: string; price: string; quantity?: string; accountIds?: number[]; pricing?: PricingChange; onChange: (productId: number, skuId: number, price?: string, pricing?: PricingChange) => void };
const manualPricing = (): PricingChange => ({ priceSource: "MANUAL", catalogPriceTier: null, priceExceptionLineId: null, priceExceptionCode: null, priceExceptionUnitPrice: null, priceExceptionCurrencyCode: null, priceExceptionSourceQty: null, priceExceptionAccountIds: [] });
const moqState = (quantity: string, moq: string | null) => {
  if (!/^\d+$/.test(quantity) || !moq || !/^\d+(?:\.\d+)?$/.test(moq) || Number(moq) <= 0) return "UNKNOWN" as const;
  return Number(quantity) >= Number(moq) ? "ELIGIBLE" as const : "INELIGIBLE" as const;
};
export function ProductPicker(props: Props) {
  const { index, productId, skuId, categories, currencyCode, price, quantity = "", accountIds = [], onChange } = props;
  const pricing = props.pricing ?? manualPricing();
  const legacyInferredSource = props.pricing === undefined;
  const uid = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [legacyProduct, setLegacyProduct] = useState<{ id: number; name: string; categoryId: number | null } | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState<ProductPriceTier | "">(pricing.catalogPriceTier ?? "");
  const [peOptions, setPeOptions] = useState<Candidate[]>([]);
  const [showPe, setShowPe] = useState(pricing.priceSource === "PRICE_EXCEPTION");
  const [searchAll, setSearchAll] = useState(false);
  const [peQuery, setPeQuery] = useState("");
  const [peLoading, setPeLoading] = useState(false);
  const accountKey = accountIds.join(",");
  useEffect(() => {
    if (!skuId) return;
    const controller = new AbortController();
    fetch(`/opportunities/product-search?skuId=${skuId}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data?.item) setItem(data.item); }).catch(() => {});
    return () => controller.abort();
  }, [skuId]);
  useEffect(() => {
    if (!productId || skuId) return;
    const controller = new AbortController();
    fetch(`/opportunities/product-search?id=${productId}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data?.product) setLegacyProduct(data.product); }).catch(() => {});
    return () => controller.abort();
  }, [productId, skuId]);
  useEffect(() => {
    if (!productId || categoryId === null) return;
    const selectedCategory = skuId ? (item?.id === skuId ? item.categoryId : undefined) : (legacyProduct?.id === productId ? legacyProduct.categoryId : undefined);
    if (selectedCategory !== undefined && !selectedProductFitsCategory(categoryId, selectedCategory)) {
      queueMicrotask(() => { onChange(0, 0); setItem(null); setLegacyProduct(null); setTier(""); });
    }
  }, [categoryId, item, legacyProduct, onChange, productId, skuId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/opportunities/product-search?q=${encodeURIComponent(query)}&currencyCode=${encodeURIComponent(currencyCode)}${categoryId === null ? "" : `&categoryId=${categoryId}`}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : { items: [] })
        .then(data => { setResults(data.items ?? []); setActive(0); }).catch(() => {})
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, currencyCode, categoryId, open]);
  useEffect(() => {
    if (!showPe || !skuId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPeLoading(true);
      const params = new URLSearchParams({ skuId: String(skuId), currencyCode, accountIds: accountKey, scope: searchAll ? "all" : "related" });
      if (searchAll && peQuery.trim()) params.set("q", peQuery.trim());
      fetch(`/opportunities/price-exception-search?${params}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : { options: [] })
        .then(data => setPeOptions(data.options ?? []))
        .catch(() => {})
        .finally(() => { if (!controller.signal.aborted) setPeLoading(false); });
    }, searchAll ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [showPe, skuId, currencyCode, accountKey, searchAll, peQuery]);
  const prices = item ? pricesForCurrency(item, currencyCode) : [];
  const selectedTier = prices.find(option => option.tier === tier) ?? null;
  const inferredTier = prices.find(option => option.amount === price) ?? null;
  const shownTier = selectedTier ?? inferredTier;
  const choose = (selected: CatalogItem) => {
    const choice = selectCatalogItem(selected, currencyCode);
    setItem(selected); setTier(choice.tier); setQuery(""); setOpen(false);
    setShowPe(false); setSearchAll(false); setPeOptions([]);
    onChange(choice.productId, choice.skuId, choice.price, choice.tier ? { ...manualPricing(), priceSource: "CATALOG", catalogPriceTier: choice.tier } : manualPricing());
  };
  const optionState = (option: Candidate) => moqState(quantity, option.moq);
  const eligiblePeOptions = peOptions.filter(option => optionState(option) === "ELIGIBLE");
  const ineligiblePeOptions = peOptions.filter(option => optionState(option) === "INELIGIBLE");
  const unknownMoqOptions = peOptions.filter(option => optionState(option) === "UNKNOWN");
  const renderPeOption = (option: Candidate, state: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN") => {
    const partyText = option.parties.map(party => `${party.role}: ${party.accountName ?? party.sourceName ?? "—"}${party.matchesOpportunity ? " (match)" : ""}`).join(" · ");
    const selectable = state === "ELIGIBLE";
    return <button key={option.lineId} type="button" disabled={!selectable} className={`block w-full rounded border px-2 py-1.5 text-left ${pricing.priceExceptionLineId === option.lineId ? "border-orange-500 bg-white" : selectable ? "border-slate-200 bg-white hover:border-orange-300" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500"}`} onClick={() => {
      if (!selectable) return;
      const next = { ...manualPricing(), priceSource: "PRICE_EXCEPTION" as const, priceExceptionLineId: option.lineId, priceExceptionCode: option.peCode, priceExceptionUnitPrice: option.unitPrice, priceExceptionCurrencyCode: option.currencyCode, priceExceptionSourceQty: option.moq, priceExceptionAccountIds: option.parties.flatMap(party => party.accountId ? [party.accountId] : []) };
      onChange(productId, skuId, option.unitPrice, next); setShowPe(true);
    }}><span className="font-semibold">PE {option.peCode ?? "Unnumbered"} · {formatCurrency(Number(option.unitPrice), option.currencyCode)}</span><span className="block text-slate-600">{option.moq ? `MOQ ${option.moq}` : `MOQ unresolved${option.moqRaw ? `: ${option.moqRaw}` : ""}`} · Exp: {option.expirationDate ?? "—"}</span>{partyText && <span className="block text-slate-600">{partyText}</span>}{!option.matchedRoles.length && <span className="block text-amber-700">No linked PE account matches this Opportunity.</span>}{state === "INELIGIBLE" && <span className="block text-amber-700">Requires quantity of at least {option.moq}.</span>}{state === "UNKNOWN" && <span className="block text-amber-700">A numeric MOQ is required before this price can be applied.</span>}{option.comments && <span className="block truncate text-slate-500">{option.comments}</span>}</button>;
  };
  const selectedMoqState = pricing.priceSource === "PRICE_EXCEPTION" ? moqState(quantity, pricing.priceExceptionSourceQty) : null;
  return <div className="relative min-w-0">
    <input type="hidden" name="productId" value={productId || ""}/><input type="hidden" name="skuId" value={skuId || ""}/><input type="hidden" name="priceSource" value={pricing.priceSource}/><input type="hidden" name="catalogPriceTier" value={pricing.catalogPriceTier ?? ""}/><input type="hidden" name="priceExceptionLineId" value={pricing.priceExceptionLineId ?? ""}/>
    {!productId && <><label className="sr-only" htmlFor={`${uid}-category`}>Product Category {index + 1}</label><select id={`${uid}-category`} className="field mb-1" value={categoryId ?? ""} onChange={event => { setCategoryId(event.target.value ? Number(event.target.value) : null); setResults([]); setActive(0); }}><option value="">All categories</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></>}
    {productId > 0 && <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"><strong className="text-base leading-tight">{item?.productName ?? legacyProduct?.name ?? `Product #${productId}`}</strong>{item && <span className="text-xs text-slate-600">SKU: {item.partNumber}</span>}{item?.catalogSource === "ODM" && <span className="rounded bg-orange-50 px-1.5 py-0.5 text-xs font-semibold text-orange-800">ODM{item.odmCustomerName ? ` · ${item.odmCustomerName}` : ""}</span>}{item?.description && <details className="text-xs text-slate-500"><summary className="cursor-pointer">Details</summary><p className="mt-1 whitespace-normal">{item.description}</p></details>}{!skuId && <span className="block text-slate-500">Historical product line · manual price</span>}<button type="button" className="text-xs text-orange-800 underline" onClick={() => { onChange(0, 0); setItem(null); setTier(""); setQuery(""); setOpen(true); }}>Change</button></div>}
    {(!productId || open) && <><label className="sr-only" htmlFor={`${uid}-search`}>Catalog item {index + 1}</label><input id={`${uid}-search`} className="field mt-1" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${uid}-results`} aria-activedescendant={open && results[active] ? `${uid}-option-${active}` : undefined} placeholder="Search model, part number, ODM customer or description" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(value => Math.min(value + 1, Math.max(0, results.length - 1))); } if (event.key === "ArrowUp") { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); } if (event.key === "Enter" && open && results[active]) { event.preventDefault(); choose(results[active]); } if (event.key === "Escape") setOpen(false); }} onBlur={() => setTimeout(() => setOpen(false), 100)}/></>}
    {open && <div id={`${uid}-results`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded border border-slate-300 bg-white shadow-lg">{results.map((result, i) => { const standard = pricesForCurrency(result, currencyCode).find(option => option.tier === "STANDARD"); return <button type="button" role="option" aria-selected={i === active} id={`${uid}-option-${i}`} key={result.id} className={`block w-full px-3 py-2 text-left text-sm ${i === active ? "bg-orange-50" : "hover:bg-slate-50"}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(result)}><strong>{result.productName}</strong><span className="ml-2 text-slate-700">{result.partNumber}</span>{result.catalogSource === "ODM" && <span className="ml-2 rounded bg-orange-50 px-1.5 py-0.5 text-xs font-semibold text-orange-800">ODM{result.odmCustomerName ? ` · ${result.odmCustomerName}` : ""}</span>}{result.description && <span className="block text-slate-500">{result.description}</span>}{result.odmDescription && <span className="block text-xs text-slate-500">{result.odmDescription}</span>}{standard && <span className="block text-xs text-slate-600">STANDARD {formatCurrency(Number(standard.amount), currencyCode)}</span>}</button>; })}{!loading && !results.length && <p className="p-3 text-sm text-slate-500">No catalog items found.</p>}{loading && <p className="p-3 text-sm text-slate-500" role="status">Searching…</p>}</div>}
    {odmCustomerWarning(item, accountIds) && <p className="mt-1 text-xs text-amber-700" role="status">{odmCustomerWarning(item, accountIds)}</p>}{item && <div className="mt-2 space-y-2 text-xs"><div className="flex flex-wrap items-center gap-2"><label className="shrink-0 text-slate-500" htmlFor={`${uid}-tier`}>Price source<span className="sr-only"> {index + 1}</span></label><select id={`${uid}-tier`} className="min-w-0 max-w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs" value={pricing.priceSource === "PRICE_EXCEPTION" ? "PRICE_EXCEPTION" : pricing.priceSource === "CATALOG" ? (shownTier?.tier ?? pricing.catalogPriceTier ?? "") : legacyInferredSource ? (shownTier?.tier ?? "") : ""} onChange={event => { if (event.target.value === "PRICE_EXCEPTION") { setShowPe(true); return; } if (!event.target.value) { setTier(""); setShowPe(false); onChange(productId, skuId, undefined, manualPricing()); return; } const chosen = prices.find(option => option.tier === event.target.value); setTier(chosen?.tier ?? ""); setShowPe(false); if (chosen) onChange(productId, skuId, chosen.amount, { ...manualPricing(), priceSource: "CATALOG", catalogPriceTier: chosen.tier }); }}><option value="">Manual price</option>{prices.map(option => <option key={option.tier} value={option.tier}>{option.tier} · {formatCurrency(Number(option.amount), currencyCode)}</option>)}<option value="PRICE_EXCEPTION">Price Exception…</option></select>{(pricing.priceSource === "CATALOG" || legacyInferredSource) && selectedTier && selectedTier.amount !== price && <span className="text-amber-700">Manual price override</span>}</div>{!prices.length && pricing.priceSource !== "PRICE_EXCEPTION" && <p className="text-slate-600">No catalog price in {currencyCode}; manual pricing is available.</p>}
      {showPe && <div className="rounded border border-orange-200 bg-orange-50/40 p-2"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong>{searchAll ? "All valid Price Exceptions for this SKU" : "Related Price Exceptions"}</strong>{!searchAll ? <button type="button" className="text-orange-800 underline" onClick={() => { setSearchAll(true); setPeQuery(""); }}>Search all PEs for this SKU</button> : <button type="button" className="text-orange-800 underline" onClick={() => { setSearchAll(false); setPeQuery(""); }}>Show related only</button>}</div>{searchAll && <input className="field mb-2 py-1 text-xs" aria-label={`Search all Price Exceptions ${index + 1}`} placeholder="PE number, party, MOQ, price" value={peQuery} onChange={event => setPeQuery(event.target.value)}/>}<div className="max-h-56 space-y-2 overflow-y-auto">{!!eligiblePeOptions.length && <div><div className="mb-1 font-semibold text-emerald-800">Eligible</div><div className="space-y-1">{eligiblePeOptions.map(option => renderPeOption(option, "ELIGIBLE"))}</div></div>}{!!ineligiblePeOptions.length && <div><div className="mb-1 font-semibold text-amber-800">Not eligible</div><div className="space-y-1">{ineligiblePeOptions.map(option => renderPeOption(option, "INELIGIBLE"))}</div></div>}{!!unknownMoqOptions.length && <div><div className="mb-1 font-semibold text-amber-800">Unknown MOQ</div><div className="space-y-1">{unknownMoqOptions.map(option => renderPeOption(option, "UNKNOWN"))}</div></div>}{!peLoading && !peOptions.length && <p className="text-slate-500">{searchAll ? "No matching valid Price Exceptions." : "No related Price Exceptions found."}</p>}{peLoading && <p className="text-slate-500" role="status">Loading Price Exceptions…</p>}</div></div>}
      {pricing.priceSource === "PRICE_EXCEPTION" && <div className="rounded bg-slate-50 p-2"><span className="font-semibold">Selected: PE {pricing.priceExceptionCode ?? "Unnumbered"} · {pricing.priceExceptionUnitPrice ? formatCurrency(Number(pricing.priceExceptionUnitPrice), pricing.priceExceptionCurrencyCode ?? currencyCode) : "—"} · MOQ {pricing.priceExceptionSourceQty ?? "unresolved"}</span>{pricing.priceExceptionUnitPrice !== null && pricing.priceExceptionUnitPrice !== price && <span className="ml-2 text-amber-700">Opportunity price manually overridden to {formatCurrency(Number(price), currencyCode)}</span>}{selectedMoqState === "INELIGIBLE" && <span className="block text-amber-700">Current quantity does not meet the selected PE MOQ of {pricing.priceExceptionSourceQty}. Adjust quantity or choose another pricing source before saving.</span>}{selectedMoqState === "UNKNOWN" && <span className="block text-amber-700">The selected PE has no resolved numeric MOQ. Choose another pricing source before changing this line.</span>}{!pricing.priceExceptionAccountIds.some(id => accountIds.includes(id)) && <span className="block text-amber-700">No linked PE account matches this Opportunity.</span>}</div>}
    </div>}
  </div>;
}
