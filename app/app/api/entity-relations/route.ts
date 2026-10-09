import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { can, opportunityScope } from '@/lib/authorization';
import { prisma } from '@/lib/prisma';
import { operationalOpportunityWhere, operationalProjectWhere } from '@/lib/operational-where';
import { projectReadWhere } from '@/lib/projects';

export async function GET(request: NextRequest) {
  const actor = await currentUser();
  if (!can(actor, 'accounts.read')) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const number = (key: string) => { const id = Number(request.nextUrl.searchParams.get(key)); return Number.isSafeInteger(id) && id > 0 ? id : 0; };
  const accountId = number('accountId'), opportunityId = number('opportunityId'), projectId = number('projectId');
  if (!accountId) return NextResponse.json({ opportunityValid: false, projectValid: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  const [opportunity, project] = await Promise.all([
    opportunityId && can(actor, 'opportunities.read') ? prisma.opportunity.findFirst({ where: { id: opportunityId, AND: [operationalOpportunityWhere, opportunityScope(actor)], participants: { some: { accountId } } }, select: { id: true } }) : null,
    projectId && can(actor, 'projects.read') ? prisma.project.findFirst({ where: { id: projectId, AND: [operationalProjectWhere, projectReadWhere(actor)], OR: [{ primaryAccountId: accountId }, { participants: { some: { accountId } } }] }, select: { id: true } }) : null,
  ]);
  return NextResponse.json({ opportunityValid: !!opportunity, projectValid: !!project }, { headers: { 'Cache-Control': 'private, no-store' } });
}
