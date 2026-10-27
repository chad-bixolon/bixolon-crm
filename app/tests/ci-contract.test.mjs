import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { migrationChanged } from '../scripts/release-check.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../scripts/release-check.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('hosted CI keeps the local release gates and pinned runtime', () => {
  for (const command of ['ci:preflight', 'prisma:generate', 'ci:prisma-alignment', 'lint', 'typecheck', 'test:e2e:release-smoke', 'build:release']) {
    assert.ok(pkg.scripts[command], `Missing npm script: ${command}`);
    assert.ok(workflow.includes(`npm run ${command}`), `CI no longer runs ${command}`);
  }
  assert.match(workflow, /run: npm test\s/);
  assert.match(workflow, /node-version-file: app\/\.nvmrc/);
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /55432:5432/);
  assert.match(workflow, /git diff --check "\$PR_BASE_SHA" HEAD/);
  assert.match(workflow, /git diff --check "\$PUSH_BEFORE_SHA" HEAD/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /if: github\.event_name == 'push'[\s\S]*?Build production Docker image/);
  assert.match(workflow, /app\/prisma\/schema\.prisma app\/prisma\.config\.ts app\/prisma\/migrations\/ app\/prisma\/tests\/ app\/scripts\/test-migrations\.py app\/scripts\/prisma-generate\.mjs app\/Dockerfile app\/\.dockerignore app\/package\.json app\/package-lock\.json \.github\/workflows\/ci\.yml/);
  assert.match(workflow, /npm run test:migrations/);
  for (const path of ['app/prisma/schema.prisma', 'app/prisma.config.ts', 'app/prisma/migrations/20261027_ci/migration.sql', 'app/prisma/tests/integrity.sql', 'app/scripts/test-migrations.py', 'app/scripts/prisma-generate.mjs', 'app/Dockerfile', 'app/.dockerignore', 'app/package.json', 'app/package-lock.json', '.github/workflows/ci.yml']) {
    assert.equal(migrationChanged([path]), true, 'Local release check would skip ' + path);
  }
  assert.match(pkg.scripts['build:release'], /--webpack/);
  assert.match(pkg.scripts['test:e2e:release-smoke'], /--workers=1 --retries=0/);
  assert.match(pkg.scripts['test:migrations'], /scripts\/test-migrations\.py/);
  for (const command of ['test:migrations', 'test:e2e:release-smoke', 'build:release']) {
    assert.ok(release.includes(`'${command}'`), `Local release checker no longer uses ${command}`);
  }
});

test('fresh checkout includes every synthetic import source needed by unit tests', () => {
  for (const name of [
    'BIXOLON_Price_List.xlsx',
    'ODM customer pricing_Sep 2026.xlsx',
    'FSTEC.xlsx',
    'Leads_Report_RetailNOW.xlsx',
    'Distributor Price Exceptions 02052020 - Copy.xlsx',
    'price-exceptions-2026-09-25.csv',
    'demo-requests-2026-09-28.csv',
    '2025_Label Printer Sales PLan_2025 Development Projects_12242024.xlsx',
    '2027_Sales Plan_BIXNA_Rev1.xlsx',
  ]) assert.ok(existsSync(new URL(`./fixtures/ci-source/${name}`, import.meta.url)), `Missing CI fixture: ${name}`);
});
