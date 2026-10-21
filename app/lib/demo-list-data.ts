import type { Prisma } from '@prisma/client';

// Only fields consumed by DemoList and its deployment/return summary.
export const demoListSelect = {
  id: true, sourceRequestId: true, demoNumber: true, status: true, requestedAt: true,
  durationValue: true, durationUnit: true, shippedAt: true, expectedReturnOverrideAt: true,
  requestedBy: { select: { firstName: true, lastName: true } },
  items: { select: { sourceSku: true, quantity: true, retiredAt: true,
    units: { select: { id: true, ordinal: true, serialNumber: true, status: true, deployedAt: true, returnedAt: true, inventoryLocation: true }, orderBy: { ordinal: 'asc' } },
    productSku: { select: { partNumber: true, product: { select: { name: true } } } },
  }, orderBy: { id: 'asc' } },
  project: { select: { id: true, name: true, status: true, archivedAt: true } },
  opportunity: { select: { id: true, name: true, stage: { select: { isClosed: true, isWon: true } } } },
} as const satisfies Prisma.DemoRequestSelect;
