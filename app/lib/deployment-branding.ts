import type { PrismaClient } from '@prisma/client';
import { cache } from 'react';
import { prisma } from './prisma';

export const defaultBranding = { companyName: 'BIXOLON America, Inc.', productName: 'SalesHub', logoStorageKey: null, logoMimeType: null } as const;
export type Branding = { companyName: string; productName: string; logoStorageKey: string | null; logoMimeType: string | null; updatedAt?: Date };

const readDefaultBranding = cache(async (): Promise<Branding> =>
  await prisma.deploymentBranding.findUnique({ where: { id: 1 } }) ?? defaultBranding);

export async function getBranding(client: Pick<PrismaClient, 'deploymentBranding'>): Promise<Branding> {
  // Transaction clients read directly; only the application singleton is shared within a render.
  return client === prisma ? readDefaultBranding() : await client.deploymentBranding.findUnique({ where: { id: 1 } }) ?? defaultBranding;
}

export function parseBrandName(raw: string, label: string) {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} must be 1–200 printable characters.`);
  return value;
}

export function brandedTitle(branding: Pick<Branding, 'companyName' | 'productName'>) {
  return branding.companyName === defaultBranding.companyName && branding.productName === defaultBranding.productName
    ? 'BIXOLON SalesHub' : `${branding.companyName} ${branding.productName}`;
}

export function exportProductPrefix(productName: string) {
  return productName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Application';
}
