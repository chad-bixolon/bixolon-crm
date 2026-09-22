import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { prisma } from '@/lib/prisma';
import { TradeShowImportWorkflow } from './workflow';
export const dynamic='force-dynamic';
export default async function ImportPage({params}:{params:Promise<{id:string}>}){const actor=await currentUser();if(!can(actor,'trade-shows.manage'))redirect('/access-denied');const id=Number((await params).id);if(!Number.isSafeInteger(id)||id<1)notFound();const show=await prisma.tradeShow.findUnique({where:{id},select:{name:true,timezone:true,archivedAt:true}});if(!show)notFound();return <Content><PageHeader eyebrow={show.name} title="Import Trade Show Leads" action={<Link href={`/trade-shows/${id}`} className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">Back to Trade Show</Link>}/>{show.archivedAt?<p className="panel p-6">Reactivate this Trade Show before importing.</p>:<TradeShowImportWorkflow showId={id} timezone={show.timezone}/>}</Content>}
