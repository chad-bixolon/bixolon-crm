import { ForecastCategory, type PrismaClient } from "@prisma/client";
import type { Actor } from './authorization';

export function parseStage(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const probabilityRaw = String(form.get("probability") ?? "");
  const orderRaw = String(form.get("sortOrder") ?? "");
  const probability = Number(probabilityRaw);
  const sortOrder = Number(orderRaw);
  if (!name || name.length > 200) throw new Error("Name must be 1–200 characters.");
  if (!/^\d+$/.test(probabilityRaw) || !Number.isInteger(probability) || probability > 100) throw new Error("Probability must be 0–100.");
  if (!/^\d+$/.test(orderRaw) || !Number.isSafeInteger(sortOrder)) throw new Error("Sort order must be a nonnegative whole number.");
  const isClosed = form.has("isClosed");
  const isWon = form.has("isWon");
  if (isWon && !isClosed) throw new Error("A won stage must also be closed.");
  return { name, probability, sortOrder, active: form.has("active"), isClosed, isWon };
}
export async function saveStage(client: PrismaClient, id: number | null, data: ReturnType<typeof parseStage>, actor?: Actor) {
  if (id !== null) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid stage.");
    await client.$transaction(async tx => {
      const previous = await tx.salesStage.findUnique({ where: { id } });
      if (!previous) throw new Error('Stage not found.');
      await tx.salesStage.update({ where: { id }, data });
      if (previous.isClosed !== data.isClosed || (data.isClosed && previous.isWon !== data.isWon)) {
        const forecastCategory = data.isClosed ? (data.isWon ? ForecastCategory.CLOSED : ForecastCategory.OMITTED) : ForecastCategory.PIPELINE;
        const changed = actor ? await tx.opportunity.findMany({ where: { stageId: id, forecastCategory: { not: forecastCategory } }, select: { id: true, name: true, forecastCategory: true, participants: { include: { account: { select: { name: true } } }, take: 1 } } }) : [];
        const user = actor ? await tx.user.findUnique({ where: { id: actor.id }, select: { firstName: true, lastName: true } }) : null;
        await tx.opportunity.updateMany({ where: { stageId: id }, data: { forecastCategory } });
        if (changed.length) await tx.opportunityHistoryEvent.createMany({ data: changed.map(row => ({ opportunityId: row.id, opportunityName: row.name, accountName: row.participants[0]?.account.name ?? null, actorId: actor!.id, actorName: user ? `${user.firstName} ${user.lastName}` : null, eventType: 'FORECAST_CATEGORY', oldCategory: row.forecastCategory, newCategory: forecastCategory })) });
      }
    });
  } else await client.salesStage.create({ data });
}
