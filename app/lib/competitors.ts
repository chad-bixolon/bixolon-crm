import type { PrismaClient } from "@prisma/client";

export function parseCompetitor(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const rawOrder = String(form.get("sortOrder") ?? "").trim();
  const sortOrder = Number(rawOrder);
  if (!name || name.length > 200) throw new Error("Name is required and must be 200 characters or fewer.");
  if (!/^\d+$/.test(rawOrder) || !Number.isSafeInteger(sortOrder)) throw new Error("Enter a whole sort order of zero or more.");
  return { name, sortOrder, active: form.has("active") };
}

export async function saveCompetitor(client: PrismaClient, input: ReturnType<typeof parseCompetitor>, id?: number) {
  const duplicate = await client.competitorOption.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  if (duplicate) throw new Error("A competitor with this name already exists.");
  if (id) return client.competitorOption.update({ where: { id }, data: input });
  return client.competitorOption.create({ data: input });
}
