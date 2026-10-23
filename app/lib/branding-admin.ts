import { Prisma, type PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import { getBranding, parseBrandName } from './deployment-branding';
import type { DocumentStorage } from './document-storage';

export async function saveBrandingNames(client: PrismaClient, actor: Actor, companyRaw: string, productRaw: string) {
  assertPermission(actor, 'deployment.manage');
  const companyName = parseBrandName(companyRaw, 'Company Name');
  const productName = parseBrandName(productRaw, 'Product Name');
  await client.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341024)`;
    assertPermission(await tx.user.findUnique({ where: { id: actor.id } }), 'deployment.manage');
    const old = await getBranding(tx);
    if (old.companyName === companyName && old.productName === productName) return;
    await tx.deploymentBranding.upsert({ where: { id: 1 }, create: { id: 1, companyName, productName }, update: { companyName, productName } });
    for (const [action, before, after] of [
      ['Company Name changed', old.companyName, companyName], ['Product Name changed', old.productName, productName],
    ]) if (before !== after) await tx.adminMaintenanceEvent.create({ data: { actorId: actor.id, entityType: 'Branding', action, recordIds: [], recordCount: 1, oldValue: before, newValue: after } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setBrandingLogo(client: PrismaClient, storage: DocumentStorage, actor: Actor, logo: { body: Uint8Array; mimeType: string } | null) {
  assertPermission(actor, 'deployment.manage');
  const storageKey = logo ? storage.createBrandingKey() : null;
  if (logo && storageKey) await storage.uploadDocumentObject({ storageKey, body: logo.body, mimeType: logo.mimeType });
  let oldKey: string | null = null;
  try {
    await client.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72341024)`;
      assertPermission(await tx.user.findUnique({ where: { id: actor.id } }), 'deployment.manage');
      const old = await getBranding(tx);
      oldKey = old.logoStorageKey;
      if (!oldKey && !storageKey) return;
      await tx.deploymentBranding.upsert({ where: { id: 1 }, create: { id: 1, companyName: old.companyName, productName: old.productName, logoStorageKey: storageKey, logoMimeType: logo?.mimeType ?? null }, update: { logoStorageKey: storageKey, logoMimeType: logo?.mimeType ?? null } });
      await tx.adminMaintenanceEvent.create({ data: { actorId: actor.id, entityType: 'Branding', action: logo ? 'Logo changed' : 'Logo reset', recordIds: [], recordCount: 1, oldValue: oldKey ? 'Custom logo' : 'Default BIXOLON logo', newValue: logo ? 'Custom logo' : 'Default BIXOLON logo' } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (storageKey) await storage.deleteDocumentObject(storageKey).catch(() => {});
    throw error;
  }
  if (oldKey && oldKey !== storageKey) await storage.deleteDocumentObject(oldKey).catch(error => console.error('Could not retire previous branding logo.', error));
}

export function fallbackLogo() { return { src: '/brand/bixolon-logo.png', alt: 'BIXOLON' }; }
export function brandingLogo(branding: { logoStorageKey: string | null; companyName: string }) {
  return branding.logoStorageKey ? { src: '/api/branding/logo', alt: branding.companyName } : fallbackLogo();
}
