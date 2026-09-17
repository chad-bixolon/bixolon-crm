import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import Link from 'next/link';
import { WorkForm, ReactivateNote } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { prisma } from '@/lib/prisma';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}) { const id=Number((await params).id); if(!Number.isSafeInteger(id)||id<1) notFound(); const row=await prisma.note.findUnique({where:{id}}); if(!row) notFound(); if(row.archivedAt) return <Content><PageHeader title="Archived note" eyebrow="Notes"/><div className="panel space-y-4 p-6"><p role="status">This note was archived.</p><div className="flex gap-3"><ReactivateNote id={id}/><Link className="btn-secondary" href={row.projectId ? `/projects/${row.projectId}?tab=notes&notesView=archived` : row.opportunityId ? `/opportunities/${row.opportunityId}?notesView=archived` : row.accountId ? `/accounts/${row.accountId}?tab=notes&notesView=archived` : '/tasks'}>Back to records</Link></div></div></Content>; const options=await workOptions(); return <Content><PageHeader title="Edit note" eyebrow="Notes"/><WorkForm kind="note" id={id} {...options} initial={{body:row.body,accountId:row.accountId,opportunityId:row.opportunityId,projectId:row.projectId}}/></Content>; }
