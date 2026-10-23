import { DeploymentModule, Prisma, type PrismaClient } from '@prisma/client';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { prisma } from './prisma';
import { assertPermission, type Actor } from './authorization';

import { moduleDefinitions, modules, resolveModules, type ModuleAvailability } from "./module-policy";
export { moduleDefinitions, modules, moduleForPath, requiredModulesForPath, moduleForSavedView, moduleForNotificationCategory, moduleForAuditEntity, qualityIssueAvailable, moduleForReportType, reportTypeAvailable, builtInReportAvailable, dashboardWidgetAvailable, resolveModules } from "./module-policy";
export type { ModuleAvailability } from "./module-policy";

export async function readModules(db: Pick<PrismaClient, 'deploymentModuleVisibility'>): Promise<ModuleAvailability> {
  if (!db.deploymentModuleVisibility) return resolveModules([]); // Existing isolated test doubles.
  try { return resolveModules(await db.deploymentModuleVisibility.findMany({ select: { module: true, enabled: true } })); }
  catch (error) {
    // The old application and the new code can overlap during the additive rollout.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') return resolveModules([]);
    throw error;
  }
}

export const getModuleAvailability = cache(() => readModules(prisma));
export async function assertModuleEnabled(module: DeploymentModule) {
  if (!(await getModuleAvailability()).effective.has(module)) throw new Error(`${moduleDefinitions[module].name} is unavailable in this deployment.`);
}
export async function requireModuleEnabled(module: DeploymentModule) {
  if (!(await getModuleAvailability()).effective.has(module)) notFound();
}

export async function assertWorkModuleContext(
  next: { opportunityId?: number | null; projectId?: number | null; supportCaseId?: number | null },
  previous: { opportunityId?: number | null; projectId?: number | null; supportCaseId?: number | null } = {},
) {
  const availability = await getModuleAvailability();
  for (const [field, module] of [['opportunityId','OPPORTUNITIES'],['projectId','PROJECTS'],['supportCaseId','SUPPORT_CASES']] as const) {
    if (!availability.effective.has(module) && (next[field] || previous[field]) && next[field] !== previous[field])
      throw new Error(`${moduleDefinitions[module].name} is unavailable in this deployment.`);
  }
}

export async function setModuleVisibility(db: PrismaClient, actor: Actor, module: DeploymentModule, enabled: boolean) {
  assertPermission(actor, 'deployment.manage');
  if (!modules.includes(module) || typeof enabled !== 'boolean') throw new Error('Invalid module setting.');
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341025)`;
    assertPermission(await tx.user.findUnique({ where: { id: actor.id } }), 'deployment.manage');
    const before = await readModules(tx as unknown as PrismaClient);
    if (before.configured.has(module) === enabled) return;
    await tx.deploymentModuleVisibility.upsert({ where: { module }, create: { module, enabled, updatedById: actor.id }, update: { enabled, updatedById: actor.id } });
    const after = await readModules(tx as unknown as PrismaClient);
    const affected = modules.filter(item => item !== module && before.effective.has(item) !== after.effective.has(item));
    await tx.adminMaintenanceEvent.create({ data: {
      actorId: actor.id, entityType: 'Module', action: enabled ? 'Enabled' : 'Disabled', recordIds: [], recordCount: 1,
      oldValue: `${moduleDefinitions[module].name}: ${before.configured.has(module) ? 'Enabled' : 'Disabled'}`,
      newValue: `${moduleDefinitions[module].name}: ${enabled ? 'Enabled' : 'Disabled'}${affected.length ? `; ${affected.map(item => moduleDefinitions[item].name).join(', ')} ${enabled ? 'available again' : 'unavailable through dependency'}` : ''}`,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

