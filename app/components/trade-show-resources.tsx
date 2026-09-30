type ResourceLink = { id: number; label: string; url: string };

export function TradeShowResources({ boothNumber, links }: { boothNumber: string | null; links: ResourceLink[] }) {
  return <section className="panel min-w-0 p-5 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Show resources</h2>
    {!boothNumber && !links.length ? <p className="text-sm text-slate-500">No show resources added.</p> : <div className="space-y-4">
      {boothNumber && <div><div className="label">Booth number</div><p className="break-words">{boothNumber}</p></div>}
      {!!links.length && <ul className="space-y-2">{links.map(link => <li className="min-w-0" key={link.id}><a className="break-words font-medium text-orange-800 underline underline-offset-2 hover:text-orange-950" href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a></li>)}</ul>}
    </div>}
  </section>;
}
