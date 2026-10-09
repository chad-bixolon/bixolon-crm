# Browser E2E tests

Playwright runs Chromium against a local SalesHub server on `127.0.0.1:3100`. It starts that server automatically with a separate `.next-e2e` build directory, so the usual Docker development app on port 3000 can keep running. The only Docker service used by the tests is a dedicated Postgres container from `compose.e2e.yml`, published on `127.0.0.1:55432`. Its named volume is separate from the normal development database and is never reset by ordinary test runs.

## Install and run from `/opt/bixolon-crm`

```bash
cd /opt/bixolon-crm/app
npm ci
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npx playwright install chromium
npx playwright install-deps chromium
npm run test:e2e
```

`install-deps` requires system package installation privileges. On a restricted Debian 13 host where sudo is unavailable, the missing shared libraries can instead be downloaded to the ignored local cache:

```bash
cd /opt/bixolon-crm/app
mkdir -p .playwright-deps
cd .playwright-deps
apt-get download libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libxdamage1 libxkbcommon0 libasound2t64 libatspi2.0-0t64
for package in *.deb; do dpkg-deb -x "$package" unpacked; done
cd ..
npm run test:e2e
```

The Playwright config adds that cache to Chromium's library path when present. On other Linux distributions, prefer `npx playwright install-deps chromium` or an official Playwright CI image. Browser downloads, local libraries, screenshots, traces, HTML reports, and `.next-e2e` are ignored by Git.

Run a single workflow with `npm run test:e2e -- e2e/support.spec.ts`. Run a visible browser with `npm run test:e2e:headed`; run the Playwright UI with `npm run test:e2e:ui`. The E2E runner restores Next.js generated config changes after Playwright exits. Use `npx playwright show-report` after a run to inspect the HTML report. Locally there are no retries and one worker. CI gets one retry, a trace on that retry, and a screenshot on failure.

## Data and authentication

`npm run test:e2e:prepare` starts only the dedicated Postgres service, applies normal migrations there, and idempotently seeds four E2E users plus Accounts, Contact, Product/SKUs, category, stage, currency, and a Price Exception. Test-created records have unique names and remain in this isolated database for inspection. To discard only the E2E database and all its test records, explicitly run `npm run test:e2e:reset`; the next test run recreates it. This command does not touch the normal development database.

The browser suite signs in through an Auth.js credentials provider available only when all of these hold: `NODE_ENV` is not `production`, `E2E_AUTH_ENABLED=true`, a test token is configured, and `DATABASE_URL` points to the local `saleshub_e2e` database on port 55432. The provider accepts only seeded `@e2e.saleshub.local` users and reloads the active user's role on each session read. Google OAuth and production authentication stay unchanged. The test suite covers Admin, Support, Sales, and Sales Manager sign-in. The E2E server and auth token are local test infrastructure; do not expose port 3100 publicly.

The seeded `E2E-PE-001` correction test changes its Account link. `test:e2e:prepare` restores that link before each full run. Browser tests use unique names for new cases, Opportunities, and Accounts so repeated local runs do not collide.

## When to run

Codex and developers should run the relevant E2E spec when changing forms, pickers, dialogs, navigation, conditional UI, failed-save behavior, or Support, Opportunity, and Price Exception workflows. Backend-only changes with no browser behavior need their focused unit/server tests instead. The suite is intentionally small and does not replace the full unit suite.

## Troubleshooting and future CI

- If port 3100 or 55432 is occupied, stop the conflicting local process; the E2E runner intentionally refuses to attach to an arbitrary existing app.
- If Chromium reports a missing `.so` library, use `npx playwright install-deps chromium` or the restricted Debian cache instructions above. Check `ldd .playwright-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell` for remaining missing libraries.
- If the database is unreachable, ensure Docker is available and run `npm run test:e2e:prepare`. Database setup fails closed if it cannot use the dedicated URL.
- CI will need Node 20+, Docker with Compose, Chromium plus Linux libraries (or the Playwright image), and permission to start the dedicated E2E Postgres service. No CI pipeline was added here.
