"use client";
import { useEffect, useId, useState } from "react";

type Summary = { id: number; name: string; sku: string };
type Detail = Summary & { active: boolean; archivedAt: string | null; skus: { id: number; partNumber: string; description: string | null; active: boolean; prices: { currencyCode: string; amount: string }[] }[] };
type Props = { index: number; productId: number; skuId: number; currencyCode: string; onChange: (productId: number, skuId: number, price?: string) => void };

export function ProductPicker({ index, productId, skuId, currencyCode, onChange }: Props) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    fetch(`/opportunities/product-search?id=${productId}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data?.product) setDetail(data.product); })
      .catch(() => {});
    return () => controller.abort();
  }, [productId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/opportunities/product-search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : { products: [] })
        .then(data => { setResults(data.products); setActive(0); })
        .catch(() => {})
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open]);
  const choose = (product: Summary) => { setDetail(null); setQuery(""); setOpen(false); onChange(product.id, 0); };
  const selectedSku = detail?.skus.find(sku => sku.id === skuId);
  return <div className="relative min-w-0">
    <input type="hidden" name="productId" value={productId || ""}/>
    <input type="hidden" name="skuId" value={skuId || ""}/>
    <label className="sr-only" htmlFor={`${uid}-search`}>Product {index + 1}</label>
    {productId && <div className="mb-1 text-sm"><strong>{detail?.name ?? `Product #${productId}`}</strong>{detail && (!detail.active || detail.archivedAt) && <span className="ml-1 text-slate-500">(inactive)</span>}<button type="button" className="ml-2 text-orange-800 underline" onClick={() => { onChange(0, 0); setDetail(null); setQuery(""); setOpen(true); }}>Change</button></div>}
    <input id={`${uid}-search`} className="field" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${uid}-results`} aria-activedescendant={open && results[active] ? `${uid}-option-${active}` : undefined} placeholder="Search product, SKU, description" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} onKeyDown={event => {
      if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(value => Math.min(value + 1, Math.max(0, results.length - 1))); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); }
      if (event.key === "Enter" && open && results[active]) { event.preventDefault(); choose(results[active]); }
      if (event.key === "Escape") setOpen(false);
    }} onBlur={() => setTimeout(() => setOpen(false), 100)}/>
    {open && <div id={`${uid}-results`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded border border-slate-300 bg-white shadow-lg">
      {results.map((product, i) => <button type="button" role="option" aria-selected={i === active} id={`${uid}-option-${i}`} key={product.id} className={`block w-full px-3 py-2 text-left text-sm ${i === active ? "bg-orange-50" : "hover:bg-slate-50"}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(product)}>{product.name}<span className="ml-2 text-slate-500">{product.sku}</span></button>)}
      {!loading && !results.length && <p className="p-3 text-sm text-slate-500">No products found.</p>}
      {loading && <p className="p-3 text-sm text-slate-500" role="status">Searching…</p>}
    </div>}
    {detail && <div className="mt-2"><label className="sr-only" htmlFor={`${uid}-sku`}>SKU for product {index + 1}</label><select id={`${uid}-sku`} className="field" value={skuId || ""} onChange={event => { const sku = detail.skus.find(item => item.id === Number(event.target.value)); onChange(detail.id, sku?.id ?? 0, sku?.prices.find(price => price.currencyCode === currencyCode)?.amount); }}><option value="">{detail.skus.length ? "Choose SKU (optional for legacy lines)" : "No SKUs available"}</option>{detail.skus.filter(sku => sku.active || sku.id === skuId).map(sku => <option key={sku.id} value={sku.id}>{sku.partNumber}{sku.description ? ` · ${sku.description}` : ""}{!sku.active ? " (inactive)" : ""}</option>)}</select>{selectedSku && <p className="mt-1 text-xs text-slate-500">Selected SKU: {selectedSku.partNumber}</p>}</div>}
  </div>;
}
