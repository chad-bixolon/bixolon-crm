import Link from 'next/link';
import { saveCampaign } from '@/app/marketing/attribution/actions';
import { campaignStatuses } from '@/lib/marketing-attribution';
import { campaignStatusLabel } from '@/lib/campaign-view';

type CampaignValues = { id: number; name: string; year: number | null; category: string | null; status: string; startDate: Date | null; endDate: Date | null; description: string | null };
export function CampaignForm({ campaign }: { campaign?: CampaignValues }) {
  return <form action={saveCampaign} className="panel grid gap-3 p-5 sm:grid-cols-2">
    {campaign && <input type="hidden" name="id" value={campaign.id}/>}
    <label className="text-sm">Name<input className="field mt-1 block w-full" name="name" defaultValue={campaign?.name} required maxLength={160}/></label>
    <label className="text-sm">Year<input className="field mt-1 block w-full" name="year" type="number" min={1900} max={2200} defaultValue={campaign?.year ?? ''}/></label>
    <label className="text-sm">Category<input className="field mt-1 block w-full" name="category" maxLength={120} defaultValue={campaign?.category ?? ''}/></label>
    <label className="text-sm">Status<select className="field mt-1 block w-full" name="status" defaultValue={campaign?.status ?? 'PLANNED'}>{campaignStatuses.map(status => <option key={status} value={status}>{campaignStatusLabel(status)}</option>)}</select></label>
    <label className="text-sm">Start date<input className="field mt-1 block w-full" name="startDate" type="date" defaultValue={campaign?.startDate?.toISOString().slice(0, 10) ?? ''}/></label>
    <label className="text-sm">End date<input className="field mt-1 block w-full" name="endDate" type="date" defaultValue={campaign?.endDate?.toISOString().slice(0, 10) ?? ''}/></label>
    <label className="text-sm sm:col-span-2">Description<textarea className="field mt-1 block w-full" name="description" maxLength={10000} defaultValue={campaign?.description ?? ''}/></label>
    <div className="flex flex-wrap gap-2 sm:col-span-2"><button className="btn-primary">{campaign ? 'Save Campaign' : 'Create Campaign'}</button><Link className="btn-secondary" href={campaign ? `/marketing/campaigns/${campaign.id}` : '/marketing/campaigns'}>Cancel</Link></div>
  </form>;
}
