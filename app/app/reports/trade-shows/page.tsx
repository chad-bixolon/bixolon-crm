import {notFound} from 'next/navigation';
import {currentUser} from '@/lib/current-user';
import {canRunReportType} from '@/lib/reporting';
import {TradeShowBuilder} from '../new/trade-show-builder';

export const dynamic='force-dynamic';
type Params=Record<string,string|string[]|undefined>;
export default async function TradeShowReportPage({searchParams}:{searchParams:Promise<Params>}){
  const actor=await currentUser();
  if(!canRunReportType(actor,'TRADE_SHOW'))notFound();
  return <TradeShowBuilder params={await searchParams} actor={actor} saved={null}/>;
}
