export function e2eAuthEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production' || env.E2E_AUTH_ENABLED !== 'true' || !env.E2E_AUTH_TOKEN || !env.DATABASE_URL) return false;
  try {
    const url = new URL(env.DATABASE_URL);
    const name = env.E2E_DATABASE_NAME ?? 'saleshub_e2e';
    return /^saleshub_e2e(?:_[a-z0-9_]+)?$/.test(name) && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432' && url.pathname === `/${name}`;
  } catch {
    return false;
  }
}
