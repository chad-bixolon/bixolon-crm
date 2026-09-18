"use client";
import { useEffect, useId, useState } from "react";
import { formatCurrency } from "@/lib/display-format";
import { pricesForCurrency, selectCatalogItem, type CatalogItem } from "@/lib/catalog-picker";
import type { ProductPriceTier } from "@prisma/client";

type Props = { index: number; productId: number; skuId: number; currencyCode: string; price: string; onChange: (productId: number, skuId: number, price?: string) => void };
export function ProductPicker({ index, productId, skuId, currencyCode, price, onChange }: Props) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [legacyName, setLegacyName] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState<ProductPriceTier | "">("");
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
      .then(data => { if (data?.product) setLegacyName(data.product.name); }).catch(() => {});
    return () => controller.abort();
  }, [productId, skuId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/opportunities/product-search?q=${encodeURIComponent(query)}&currencyCode=${encodeURIComponent(currencyCode)}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : { items: [] })
        .then(data => { setResults(data.items ?? []); setActive(0); }).catch(() => {})
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, currencyCode, open]);
  const prices = item ? pricesForCurrency(item, currencyCode) : [];
  const selectedTier = prices.find(option => option.tier === tier) ?? null;
  const inferredTier = prices.find(option => option.amount === price) ?? null;
  const shownTier = selectedTier ?? inferredTier;
  const choose = (selected: CatalogItem) => {
    const choice = selectCatalogItem(selected, currencyCode);
    setItem(selected); setTier(choice.tier); setQuery(""); setOpen(false);
    onChange(choice.productId, choice.skuId, choice.price);
  };
  return <div className="relative min-w-0">
    <input type="hidden" name="productId" value={productId || ""}/><input type="hidden" name="skuId" value={skuId || ""}/>
    {productId > 0 && <div className="text-sm"><strong>{item?.productName ?? legacyName ?? `Product #${productId}`}</strong>{item && <span className="block text-slate-600">{item.partNumber}{item.description ? ` · ${item.description}` : ""}</span>}{!skuId && <span className="block text-slate-500">Historical product line · manual price</span>}<button type="button" className="mt-1 text-orange-800 underline" onClick={() => { onChange(0, 0); setItem(null); setTier(""); setQuery(""); setOpen(true); }}>Change</button></div>}
    {(!productId || open) && <><label className="sr-only" htmlFor={`${uid}-search`}>Catalog item {index + 1}</label><input id={`${uid}-search`} className="field mt-1" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${uid}-results`} aria-activedescendant={open && results[active] ? `${uid}-option-${active}` : undefined} placeholder="Search model, part number, description" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(value => Math.min(value + 1, Math.max(0, results.length - 1))); } if (event.key === "ArrowUp") { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); } if (event.key === "Enter" && open && results[active]) { event.preventDefault(); choose(results[active]); } if (event.key === "Escape") setOpen(false); }} onBlur={() => setTimeout(() => setOpen(false), 100)}/></>}
    {open && <div id={`${uid}-results`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded border border-slate-300 bg-white shadow-lg">{results.map((result, i) => { const standard = pricesForCurrency(result, currencyCode).find(option => option.tier === "STANDARD"); return <button type="button" role="option" aria-selected={i === active} id={`${uid}-option-${i}`} key={result.id} className={`block w-full px-3 py-2 text-left text-sm ${i === active ? "bg-orange-50" : "hover:bg-slate-50"}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(result)}><strong>{result.productName}</strong><span className="ml-2 text-slate-700">{result.partNumber}</span>{result.description && <span className="block text-slate-500">{result.description}</span>}{standard && <span className="block text-xs text-slate-600">STANDARD {formatCurrency(Number(standard.amount), currencyCode)}</span>}</button>; })}{!loading && !results.length && <p className="p-3 text-sm text-slate-500">No catalog items found.</p>}{loading && <p className="p-3 text-sm text-slate-500" role="status">Searching…</p>}</div>}
    {item && (prices.length ? <div className="mt-2"><label className="sr-only" htmlFor={`${uid}-tier`}>Price source {index + 1}</label><select id={`${uid}-tier`} className="field" value={shownTier?.tier ?? ""} onChange={event => { const chosen = prices.find(option => option.tier === event.target.value); setTier(chosen?.tier ?? ""); if (chosen) onChange(productId, skuId, chosen.amount); }}><option value="" disabled>Choose price source or enter manual price</option>{prices.map(option => <option key={option.tier} value={option.tier}>{option.tier} · {formatCurrency(Number(option.amount), currencyCode)}</option>)}</select>{selectedTier && selectedTier.amount !== price && <p className="mt-1 text-xs text-slate-500">Manual price override</p>}</div> : <p className="mt-1 text-xs text-slate-600">Manual price · no catalog price in {currencyCode}</p>)}
  </div>;
}
