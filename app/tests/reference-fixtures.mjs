import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const syntheticFixtureMode = process.env.SALESHUB_TEST_USE_CI_FIXTURES === 'true' || !existsSync(resolve(app, '../reference-data'));

// Local release checks use the ignored source files. A fresh checkout uses
// reviewed test fixtures with matching names when those are available.
export function referenceFixturePath(name) {
  if (name.includes('/') || name.includes('..')) throw new Error('Invalid reference fixture name.');
  const local = resolve(app, '../reference-data', name);
  const tracked = resolve(app, 'tests/fixtures/ci-source', name);
  if (syntheticFixtureMode) {
    if (existsSync(tracked)) return tracked;
    throw new Error(`Missing synthetic CI fixture ${name}.`);
  }
  if (existsSync(local)) return local;
  if (existsSync(tracked)) return tracked;
  throw new Error(`Missing reference fixture ${name}. See docs/hosted-ci.md.`);
}
