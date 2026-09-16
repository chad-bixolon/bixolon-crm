import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
for (const name of ["prisma", "@prisma/client"]) {
  if (require(`${name}/package.json`).version !== "6.19.3") {
    throw new Error(`${name} must be exactly 6.19.3. Run npm ci.`);
  }
}

// Generation never connects to PostgreSQL. Do not require or pass live credentials.
// This placeholder is confined to this process; migration commands do not use it.
const result = spawnSync(
  process.execPath,
  [require.resolve("prisma/build/index.js"), "generate"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://generation:generation@127.0.0.1:1/generation",
      CHECKPOINT_DISABLE: "1",
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
