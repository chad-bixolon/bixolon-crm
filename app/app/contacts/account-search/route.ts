import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { searchEntities } from '@/lib/entity-search';

export async function GET(request: NextRequest) {
  const actor = await requirePermission("contacts.read");
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const accounts = await searchEntities(prisma, actor, 'account', q, {}, 20);
  return NextResponse.json({ accounts });
}
