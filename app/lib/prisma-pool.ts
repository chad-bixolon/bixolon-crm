// Prisma 6 opens a pool per client. Keep a small default for the single
// long-running production app process and leave explicit URL tuning intact.
export const productionConnectionLimit = 4;

export function productionDatasourceUrl(databaseUrl: string | undefined, environment: string | undefined): string | undefined {
  if (!databaseUrl || environment !== 'production') return undefined;
  const url = new URL(databaseUrl);
  if (url.searchParams.has('connection_limit')) return undefined;
  url.searchParams.set('connection_limit', String(productionConnectionLimit));
  return url.toString();
}
