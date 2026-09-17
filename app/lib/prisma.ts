import { PrismaClient } from "@prisma/client";
import { productionDatasourceUrl } from "./prisma-pool";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const datasourceUrl = productionDatasourceUrl(process.env.DATABASE_URL, process.env.NODE_ENV);
export const prisma = globalForPrisma.prisma ?? (globalForPrisma.prisma = new PrismaClient(
  datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : undefined,
));
