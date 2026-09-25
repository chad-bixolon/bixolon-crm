import type { RosaPlan } from '@/lib/rosa-price-exception-import';

type PreviewActionsProps = {
  plan: RosaPlan;
  confirmed: boolean;
  busy: boolean;
  onConfirm: (confirmed: boolean) => void;
  onApply: () => void;
};

export function PreviewActions({ plan, confirmed, busy, onConfirm, onApply }: PreviewActionsProps) {
  const readyCount = plan.counts.READY;

  return <div className="mt-5 border-t pt-4">
    {readyCount === 0 ? (
      <p className="text-sm text-slate-600">No Price Exceptions are ready to import yet. Resolve the review items and errors above, then preview the file again.</p>
    ) : (
      <>
        <p className="text-sm">This import will create {readyCount} Price Exception{readyCount === 1 ? '' : 's'} with {plan.groups.filter(group => group.disposition === 'READY').reduce((count, group) => count + group.tiers.length, 0)} pricing tiers.</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => onConfirm(event.target.checked)}/>I confirm the {readyCount} Price Exception{readyCount === 1 ? '' : 's'} ready to import shown in this preview.</label>
        <button className="btn-primary mt-3" disabled={!confirmed || busy || !readyCount || !!plan.errors.length} onClick={onApply}>Import {readyCount} Price Exception{readyCount === 1 ? '' : 's'}</button>
      </>
    )}
  </div>;
}
