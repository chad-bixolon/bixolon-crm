import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { searchEntities } from '@/lib/entity-search';

export async function GET(request:NextRequest){
  const actor = await requirePermission('users.manage');
  const q=(request.nextUrl.searchParams.get('q')??'').trim().slice(0,100);
  const accounts=(await searchEntities(prisma,actor,'account',q)).map(account=>({id:account.id,name:account.name,status:'ACTIVE',archivedAt:null}));
  return NextResponse.json({accounts});
}
