import { operationalContactWhere } from '@/lib/operational-where';
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { audienceContactInclude, canExportAudience, contactsCsv, resolveAudienceContactIds, validEmail } from "@/lib/marketing-audiences";

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const session=await auth(),actor=session?.crmUser,id=Number((await params).id);
  if(!actor||!Number.isSafeInteger(id)||id<=0)return new NextResponse("Not found",{status:404});
  const audience=await prisma.marketingAudience.findUnique({where:{id}});
  if(!audience||audience.archivedAt||!canExportAudience(actor,audience))return new NextResponse("Access denied",{status:403});
  const ready=request.nextUrl.searchParams.get("ready")==="1",resolved=await resolveAudienceContactIds(prisma,audience);
  const rows=await prisma.contact.findMany({where:{AND:[operationalContactWhere],id:{in:resolved.selected},...(ready?{marketingPreference:"OPTED_IN"}:{})},include:audienceContactInclude,orderBy:[{lastName:"asc"},{firstName:"asc"},{id:"asc"}]});
  const exported=ready?rows.filter(row=>validEmail(row.email)):rows,slug=audience.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||`audience-${id}`;
  return new NextResponse(contactsCsv(exported),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${slug}${ready?"-marketing-ready":"-selected"}.csv"`,"Cache-Control":"no-store"}});
}
