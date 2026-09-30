type ResourceLink = { id: number; label: string; url: string };

export function TradeShowResources({ boothNumber, links }: { boothNumber: string | null; links: ResourceLink[] }) {
  return <section className="panel min-w-0 p-5 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Show resources</h2>
    {!boothNumber && !links.length ? <p className="text-sm text-slate-500">No show resources added.</p> : <div className="space-y-5">
      {boothNumber && <div><h3 className="label">Booth number</h3><p className="break-words">{boothNumber}</p></div>}
      {!!links.length && <div><h3 className="label mb-1">Links</h3><ul className="divide-y divide-slate-100">{links.map(link => <li className="min-w-0" key={link.id}><a className="flex w-fit max-w-full items-start gap-2 rounded-md py-2 font-medium text-orange-800 hover:text-orange-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700" href={link.url} target="_blank" rel="noopener noreferrer"><span className="break-words">{link.label}</span><span aria-hidden="true" className="shrink-0 text-sm text-slate-400">↗</span><span className="sr-only">(opens in a new tab)</span></a></li>)}</ul></div>}
    </div>}
  </section>;
}
