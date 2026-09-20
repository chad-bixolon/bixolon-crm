import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';

export async function GET(request:NextRequest){
  await requirePermission('users.manage');
  const q=(request.nextUrl.searchParams.get('q')??'').trim().slice(0,100);
  const accounts=await prisma.account.findMany({where:{status:'ACTIVE',archivedAt:null,...(q?{name:{contains:q,mode:'insensitive' as const}}:{})},select:{id:true,name:true,status:true,archivedAt:true},orderBy:{name:'asc'},take:20});
  return NextResponse.json({accounts});
}
