import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  ...(process.env.E2E_AUTH_ENABLED === 'true' && process.env.NODE_ENV !== 'production' ? { distDir: '.next-e2e' } : {}),
};

export default nextConfig;
