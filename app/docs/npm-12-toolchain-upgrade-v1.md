# npm 12 Toolchain Upgrade v1

Toolchain-only candidate on `toolchain/npm-12-upgrade-v1`. Node stays **22.23.4** and Prisma CLI/client/generated runtime stay **6.19.3**. No schema, migration, product feature or production-data change is intended. Expected new migrations: **none**. No commit, push, merge, deployment or DigitalOcean change is authorized by this build.

## Pre-edit npm inventory

A repository-wide search of tracked files and visible configuration found **no literal npm 10.9.9 pin**. The previous npm 10.9.9 came from Chad's nvm Node 22.23.4 installation and the Node Docker distributions. Read-only inspection confirmed both previous local production and operations images reported npm 10.9.9. The shell's default `/usr/bin/node` and `/usr/bin/npm` were instead Node 20.19.2/npm 9.2.0; validation explicitly selected the nvm runtime without changing global tools.

| Location | Previous assumption or behavior |
| --- | --- |
| `app/package.json` | Node engine `>=22.23.4 <23`, Prisma 6.19.3; no npm engine or packageManager declaration. Scripts use npm run/test and lifecycle hooks. |
| `app/package-lock.json` | v3 lock, 531 package entries including root; no npm engine metadata. |
| `app/.nvmrc` | Node 22.23.4 only; npm bundled with that installation implicitly selected. |
| `app/Dockerfile` | Development Alpine and production Bookworm stages inherit bundled npm. Three `npm ci` calls; development/production invoke npm at runtime. No npm installation/version assertion. |
| `app/Dockerfile.operations` | Copies bundled npm from the pinned Node stage into PostgreSQL 17; installs recovery lock with `npm ci --omit=dev`. |
| `.github/workflows/ci.yml` | Standard and migration jobs select `.nvmrc` but do not select npm. Production image asserts Node/Prisma only. Chromium installation uses npx. |
| `.github/workflows/security.yml` | Dependency job selects Node and runs the audit helper with npm from PATH. Other jobs build/scan Docker images. |
| `.github/actions/scan-image/action.yml`, `security-sarif.yml` | No npm invocation. Trivy JSON converts to CycloneDX and SARIF; optional isolated GitHub publication. |
| `.github/dependabot.yml` | Independent app/recovery npm ecosystems; no npm CLI version setting. |
| `app/scripts/ci-preflight.mjs`, `ci-prisma-alignment.mjs`, `prisma-generate.mjs` | Node/Prisma assertions and generation; no npm assertion. |
| `app/scripts/release-check.mjs` | Records npm `--version` without enforcing it; preserves a clean-tree gate. |
| `app/tests/release-check.test.mjs` | Two fixture references simulate npm **10.9.8**, not 10.9.9. |
| `app/tests/ci-contract.test.mjs`, `backup-restore.test.mjs` | CI/security/recovery contracts without npm-version drift checks. |
| `app/scripts/operations/recovery-runtime/package.json` and lock | Separate Node/Prisma pins, v3 lock with 64 entries; no npm expectation. |
| `app/scripts/security/dependency-audit.mjs` | Four npm audit calls across both locks, full/production; asserts audit schema 2, fails closed on registry/tool/schema errors. |
| Current setup/release/deployment/hosted-CI/browser/recovery docs | npm commands without an explicit npm setup/version pin. Dated security docs describe vulnerable bundled npm internals, not a CLI version pin. Historical validation records remain historical. |

No tracked `.npmrc`, shrinkwrap, workspace configuration, linked installation strategy, npm alias, or Corepack/pnpm/yarn setup existed. Other npm references in dated documentation are command examples or historical audit reports, not version expectations.

## Compatibility and implementation

The [npm 12.2.1 manifest](https://github.com/npm/cli/blob/v12.2.1/package.json) declares Node `^22.22.2 || ^24.15.0 || >=26.0.0`; Node 22.23.4 satisfies it. The downloaded registry tarball's SHA-512 integrity was checked before executing it under Node 22.23.4. The host's globally installed npm was left unchanged.

Both manifests declare `packageManager: npm@12.2.1` and `engines.npm: 12.2.1`. The metadata documents the selected tool; explicit Docker/CI installation and runtime checks enforce it without introducing Corepack. Both lock roots record the npm engine. CI preflight verifies both manifests/locks, Node, Prisma and all npm-install Docker stages. Release validation rejects npm mismatch before generation. Negative contract tests cover old/future versions and metadata drift.

All npm-bearing Docker base stages explicitly install `npm@12.2.1`. The operations install stage copies that updated npm tree; its separate final PostgreSQL stage copies only Node and the installed recovery application. Production uses a separate Node runtime stage that removes npm/npx before copying the application. Node base tags, runtime users, PostgreSQL tooling, the pinned Go compiler/gosu source and existing gosu remediation remain unchanged. Hosted npm jobs select Node, install npm and run preflight in that order; existing required check names, triggers, permissions and gates remain. No branch protection setting was changed. Standard CI additionally fails if install changes tracked files. `.npmrc` changes trigger migration replay and dependency scanning.

## npm behavior review

The [npm 12 breaking changes](https://github.com/npm/cli/releases/tag/v12.0.0) require two compatibility settings for SalesHub:

- Dependency install scripts now require root `allowScripts`. Both manifests approve only `@prisma/client@6.19.3`, `@prisma/engines@6.19.3` and `prisma@6.19.3`; the app also approves `unrs-resolver@1.12.2`, the existing lint resolver's native fallback installer. These are all existing locked dependency install scripts. Future dependency changes require review of these approvals. Root lifecycle hooks still run; generation retains the existing credential-free helper.
- Remote dependencies default to blocked. The app's `.npmrc` sets `allow-remote=root` for its existing direct SheetJS URL. Docker copies this file before each app install. This does not permit arbitrary transitive URLs or git dependencies. Recovery has no remote dependency and needs no such override.

Unknown/abbreviated CLI flags now fail. SalesHub uses full npm flags (`--global`, `--omit=dev`, `--package-lock-only`, `--ignore-scripts`, `--json`); script and Playwright flags follow the `--` separator. No removed shrinkwrap/star/adduser commands, npm view/pkg output parsing, publish/pack output consumers or root preinstall hook exist. Existing dev/build/typecheck/postinstall/predev/prebuild hooks remain.

`npm ci` still installs locked versions and must leave tracked files unchanged. Recovery remains a separate project, with no workspaces or linked dependencies. The [12.2.1 linked-install allowScripts fix](https://github.com/npm/cli/releases/tag/v12.2.1) therefore has no demonstrated SalesHub-specific effect. npm's internal dependency refresh affects bundled tooling inventories, not the app lock's package versions.

## Lockfile and dependency review

Both regenerated locks remain **lockfileVersion 3**. The app changes only root `engines.npm`; all 530 dependency entries, versions, ordering, integrity strings, peer/optional edges and workspace metadata are unchanged.

The recovery lock records the same root engine and removes `node_modules/typescript@5.9.3`, previously marked `optional: true, peer: true`. Prisma and @prisma/client declare TypeScript as an optional peer; the recovery manifest has no TypeScript dependency. Controlled isolated regeneration using the same original manifest/lock retained it with npm 10.9.9 and pruned it with npm 12.2.1. This is an optional-peer resolution change, not an upgrade. Recovery has 63 entries including root afterward. All remaining versions, integrity strings, ordering and dependency edges are unchanged. No package version was upgraded and no new dependency was introduced. Main-app TypeScript is a declared dev dependency and remains unchanged.

## Security and artifacts

Existing npm audit flags and audit schema-2 parsing remain. Dependabot ecosystems, vulnerability policy, assessments, exceptions, Trivy configuration and optional SARIF publication remain; no exception was added. Before upgrading, all four fresh app/recovery full/production npm 10 audits reported **zero vulnerabilities**.

npm 12 changes CycloneDX component naming in `npm sbom` to use package.json names, affecting root/aliases. SalesHub's published SBOM pipeline uses **Trivy conversion from the same final-image JSON inventory**, so this npm-specific formatting change does not require a pipeline change. Final-image inventories must include app/recovery dependencies and confirm that npm, node-gyp and npm-bundled undici are absent. Validate CycloneDX references, SARIF 2.1.0 and artifact content after scanning; neither credentials nor environment files belong in these artifacts.

## Chad's local setup

From `app/`, load nvm in the shell as usual, then:

```sh
nvm use
npm install --global npm@12.2.1
node --version   # v22.23.4
npm --version    # 12.2.1
npm ci
npm run ci:preflight
```

Install only the named npm version into the selected nvm Node installation; do not upgrade Node or unrelated globals. Recheck versions after reinstalling Node, since a fresh Node distribution carries its bundled npm. CI and Docker install the version explicitly. Version-specific script approvals and the checked-in `.npmrc` are part of the project setup; do not replace them with blanket lifecycle/remote permissions.

## Validation and readiness

Executed validation results and measured timings are recorded below. Raw local logs and fresh audit/artifact evidence are in ignored `app/reports/npm12/` and `app/reports/security/`. No hosted workflow execution or GitHub settings change is claimed.

The requested committed/clean release check cannot be completed while also obeying the explicit prohibition on commits. The ordinary release command must reject this dirty candidate. A full `--allow-dirty --base HEAD` run can exercise existing validation, including migration replay for these changed tooling inputs, but must still report **NOT READY**. After separate review/commit authorization, rerun the ordinary clean release check before calling this release-ready. The clean-tree gate must not be weakened or bypassed.

## Rollback

Revert this toolchain change as one reviewed unit: restore the previous manifests, npm approvals/config, lockfiles, Docker/npm pins, CI setup and release/preflight tests; select Node **22.23.4** and install `npm@10.9.9` in its nvm environment. Restore the original app/recovery locks from the pre-upgrade revision, run `npm ci`, rebuild both images and rerun their existing validation/security gates. Preserve the gosu remediation and current Prisma **6.19.3**. Do not attempt an ad hoc downgrade of npm inside a running image. **No database rollback is required** because this change has no schema/data effect.

## Initial upgrade evidence (before final runtime remediation)

Validation ran on the current branch, based on pre-upgrade commit `6b6b09baa3cb1d2471e274068afbe29466010a69`. The ordinary release check rejected the dirty working tree as required. The full development validation used `--base HEAD --allow-dirty`, with source edits paused so the existing final candidate-content check could run. This report's results are appended afterward; an ordinary clean release check remains required for a later committed candidate.

| Check | Result |
| --- | --- |
| Node/npm version and CI preflight | Passed: Node 22.23.4, npm 12.2.1, both Prisma pins 6.19.3 |
| Clean app installs | Three completed; two clean installs had successful tracked-file fingerprint comparisons. Documentation edits overlapped the other comparison, so that comparison was discarded and repeated with edits paused. No npm-caused tracked-file mutation was found |
| Subsequent lock-only install | Passed; no tracked-file fingerprint change |
| Prisma generation/alignment | Passed using existing safe generator and normalized schema/embedded-client check |
| Focused CI/release/recovery contracts | 56 passed, 0 failed |
| Lint and TypeScript | Passed |
| Complete unit/regression suite | 1,677 passed, 0 failed, 1 skipped (existing optional canonical SQL-count fixture) |
| Existing migration build/replay | Passed: existing 91-migration replay, populated preservation, integrity, schema parity, compatibility and invalid-data rollback suite; 1,762.659 s including development-image build |
| Existing Chromium release smoke | Passed: 3/3 Chromium tests, one worker, no retries; 97.356 s including setup |
| Production Webpack build | Passed; 121.440 s |
| Production and operations Docker builds | Passed; final image version assertions match Node/npm/Prisma above |
| Runtime users | Production UID 1000 (`node`); operations UID 999 (`postgres`) |
| PostgreSQL operational tools | pg_dump/pg_restore/psql 17.11 available |
| gosu | 1.19; SHA-256 unchanged at `9808d660017e4cf5edcac898bfd83a922e0b65db945fabb6d868e060493ef6af`; named/numeric user switching passed |
| Disposable backup/restore drill | Passed: read-only backup role, verify-full TLS, clean restore, expected nonempty-target refusal, restored validation, migration status and temporary cleanup; in-memory object-store adapter, no live Spaces |
| Fresh npm audits | All four app/recovery full/production reports: zero vulnerabilities, before and after |
| Trivy scans and existing policy | Both candidate scans completed; both existing policy gates passed with zero blocking findings; detailed findings below |
| SBOM/SARIF validation | Both Trivy CycloneDX 1.7 inventories and SARIF 2.1.0 reports passed official schemas; dependency references and npm/Prisma inventory versions checked. npm SBOM probe passed its CycloneDX 1.5 schema |
| Artifact credential check | 17 bounded security artifacts checked against configured credential values; no matches; values never printed. Also checked for private-key markers and credential URLs |
| Candidate fingerprint / whitespace | Final repository/content fingerprint passed with source frozen during validation; final `git diff --check` passed after this documentation update |
| Clean committed release candidate | Outstanding: commits prohibited; ordinary dirty-tree refusal verified; no READY claim |
| Hosted GitHub execution | Not run; YAML/contracts tested locally; no push or remote setting changes |

The effective npm configuration was `install-strategy=hoisted`, `allow-remote=root`, `ignore-scripts=false`. `npx playwright --version` and the browser-install dry run passed. An additional `--with-deps --dry-run` probe exited 1 listing 41 missing host system packages; npm forwarded all flags correctly. The actual browser smoke passed using the existing documented local browser/library cache. No OS package upgrades were performed; hosted CI retains its existing `--with-deps` installation step.

The restore drill's existing harness names a fixed local image. Validation used a temporary Docker-command shim that substituted only the candidate image tag, keeping the existing source harness, local-socket guard, isolated network, tmpfs storage and fixture behavior intact. No application or operations script change was needed for the drill.

The regression suite includes existing authentication/authorization, CRM, Trade Show/partner handoff, Forecast/reporting, Support Gmail, Calendar and recovery tests. Browser smoke uses the existing shared release-smoke suite. This is test evidence; no manual product behavior changes or production/provider calls were made.

### Initial container findings (superseded by final runtime remediation)

Trivy **0.76.1** refreshed its database on this run (DB updated **2026-10-30 19:07:50 UTC**, downloaded **23:46:02 UTC**). Candidate scans and comparison scans of the existing npm 10 images used that same database. App lock audits do not cover OS packages or global npm's bundled dependencies.

| Candidate image | Critical | High | Medium | Low | Unknown | Total | Policy blockers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Production | 1 | 59 | 90 | 85 | 2 | 237 | 0 |
| Operations | 3 | 72 | 160 | 168 | 6 | 409 | 0 |

The Critical findings have no fixed version reported. Existing policy retains them for review; a green policy result is not a vulnerability-free claim. No vulnerability assessment or exception was edited.

Comparing **only the global npm paths** in the existing `saleshub-ci-production:local` and `saleshub-gosu-remediation:local` images against their candidates, each image changes from **21 npm-tooling findings (10 High, 10 Medium, 1 Low)** to **6 (3 High, 3 Medium)**. Twenty old package/advisory occurrences disappear, one ip-address advisory persists at the newer package version, and five undici advisories appear. Other OS inventory differences between dated image builds are not attributed to npm.

npm 12.2.1 bundled-tooling findings in each initial image, targeted for removal from final runtimes:

| Package | Advisory | Severity | Reported fixed version |
| --- | --- | --- | --- |
| undici 6.29.0 | CVE-2026-109383 (TLS option/certificate validation) | High | 6.29.1 |
| undici 6.29.0 | CVE-2026-109869 (content-encoding stream error) | High | 6.29.1 |
| undici 6.29.0 | CVE-2026-87018 (TLS renegotiation denial of service) | High | 6.29.1 |
| undici 6.29.0 | CVE-2026-109924 (EventSource memory exhaustion) | Medium | 6.29.1 |
| undici 6.29.0 | CVE-2026-109932 (WebSocket PONG buffering) | Medium | 6.29.1 |
| ip-address 10.7.2 | CVE-2026-111997 (IPv6 percent-character denial of service) | Medium | 10.7.4 |

These are npm's own bundled packages, not app/recovery dependency upgrades. No CRM request reachability assessment is established by a scanner result. Review these findings before treating npm 12.2.1 as a completed security remediation. The requested npm pin was not silently changed, its internal tree was not manually patched, and no exception was added to obtain passing gates.

### Measured timings

| Command | npm 10.9.9 | npm 12.2.1 |
| --- | ---: | ---: |
| Clean app `npm ci` | 44.875 s | 53.713 s, 52.365 s, 66.814 s |
| `npm install --package-lock-only --ignore-scripts` | 2.390 s | 2.887 s |
| Four full/production audits across both locks | 5.027 s (sum of command timings) | 5.077 s (audit helper including policy/evidence output) |

These are rough observations, not a controlled performance comparison. The npm 10 baseline ran in a temporary copy; npm 12 ran in the workspace, with concurrent Docker/validation activity. Caches and storage locations differed. No fresh application package was added to benchmark installation, and no optimization change followed from these timings.

### Changed files

- `.github/workflows/ci.yml`, `.github/workflows/security.yml`: install/verify pinned npm, preserve gates and extend the install/config contract.
- `app/Dockerfile`, `app/Dockerfile.operations`: explicitly install npm 12.2.1; copy app tarball policy for all app install stages.
- `app/.npmrc`: narrowly permit direct remote tarball declarations.
- `app/package.json`, `app/package-lock.json`, `app/scripts/operations/recovery-runtime/package.json`, `app/scripts/operations/recovery-runtime/package-lock.json`: tooling metadata, version-specific script approvals and regenerated locks.
- `app/scripts/ci-preflight.mjs`, `app/scripts/release-check.mjs`, `app/scripts/security/scope.mjs`: npm drift enforcement and `.npmrc` validation scope.
- `app/tests/ci-contract.test.mjs`, `app/tests/release-check.test.mjs`: tooling contracts and npm-mismatch regression coverage.
- `app/docs/npm-12-toolchain-upgrade-v1.md`, `release-checklist.md`, `hosted-ci.md`, `deployment.md`, `browser-e2e.md`, `backup-restore-rollback-v1.md`: upgrade report and deterministic setup/operations guidance.

The Node pin, Prisma/application dependency declarations, schema, migrations, vulnerability policy, Trivy action, Dependabot configuration and SARIF publication workflow are unchanged.

## Final runtime architecture

npm **12.2.1** is the standardized development/build/install/CI/release/audit package manager; it is intentionally excluded from both final runtime images. There is no npm patch upgrade or manual modification of npm's bundled dependencies. Development retains its npm dev wrapper and build lifecycle hooks. The app and recovery dependency versions/locks are unchanged by this runtime remediation.

Production uses `node node_modules/next/dist/bin/next start` as non-root `node`. The inherited Docker entrypoint executes Node directly: there is no npm or shell parent after startup. `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000`, Next's environment loading, and injected service configuration remain unchanged. Existing package start scripts remain available for local development.

Operations builds its dependency closure using npm in `operations-dependencies`, then copies only `/app` and the Node executable into the final PostgreSQL stage. It retains `USER postgres`, the cleared entrypoint, default `node scripts/operations/backup-postgres.mjs`, the existing restore/validation scripts, PostgreSQL tools and the remediated gosu binary. Invoke Prisma as `node node_modules/prisma/build/index.js migrate status` or, for a separately authorized migration, `node node_modules/prisma/build/index.js migrate deploy`. Do not use npm/npx/npm exec in runtime consoles or jobs. Before a future authorized rollout, replace any external npm-based pre-deploy/run-command overrides with these direct commands; this build does not modify DigitalOcean settings.

The removal reduces runtime attack surface and eliminates npm's `node-gyp@13.0.0` → `undici@6.29.0` dependency from both final filesystems. The three High advisories are:

- [CVE-2026-109383 / GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx): Agent drops function-valued TLS verification options.
- [CVE-2026-109869 / GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c): fetch content-encoding stream error can crash the process.
- [CVE-2026-87018 / GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm): TLS 1.2 renegotiation assertion denial of service.

These advisories remain in the pinned development/build npm distribution; runtime removal does not patch that tooling. All three are fixed in undici 6.29.1. Node 22.23.4 embeds 6.29.1 and remains unchanged. The npm copy was outside both application lock graphs; normal startup/request probes did not load it, but manual npm/node-gyp operations could reach it. Removal avoids relying on an unreachability exception. **No vulnerability suppression, assessment or exception was added.** Next's pre-existing compiled Edge primitives contain other undici-derived source; npm removal is not a claim that every undici implementation or image vulnerability disappears.

The pre-commit registry check found no later npm 12 patch. Fresh audits in that review reported 16 Moderate development package findings through minimatch (CVE-2026-118764 / GHSA-g3hv-75wg-m249), zero app production and zero recovery findings. The unchanged policy did not block them; follow up through dependency maintenance separately.

Final source-built image, functional and security validation results follow below. The clean committed release check remains required after a separately authorized commit; dirty-tree validation must not report READY.

## Final remediation validation

Validated from repository source on the current branch, without commits or production changes. These results supersede the initial runtime-image/security results above. Source edits were paused through the full validation; this results section was appended afterward. Evidence is in ignored `app/reports/npm12/final-runtime/`, with a consolidated `review.json` and the full release report linked there.

| Check | Final result |
| --- | --- |
| Clean npm 12.2.1 install | Passed in 107.054 s; tracked-file fingerprints unchanged. Subsequent lock-only install also left tracked files unchanged |
| Development/build tooling | Node 22.23.4, npm 12.2.1 and Prisma 6.19.3 asserted; preflight passed |
| Prisma generation/alignment, lint, typecheck | Passed |
| Focused Docker/CI/security/release/recovery contracts | 57 passed, zero failed |
| Complete unit/regression suite | 1,678 passed, zero failed, one existing optional SQL-count fixture skipped |
| Migration validation | All 91 existing migrations replayed; populated preservation, integrity, schema parity, compatibility and invalid-data rollback passed; fixture database/network removed |
| Browser smoke | 3 Chromium tests passed, one worker, no retries |
| Webpack production build | Passed |
| Both final Docker builds | Passed from repository Dockerfiles; development image also rebuilt and checked |
| Final runtime inventory | Node 22.23.4 and Prisma 6.19.3 retained; npm, npx, node-gyp and installed undici packages absent; `/usr/local/lib/node_modules/npm` absent |
| Production startup/environment | Direct Node/Next PID 1; custom PORT 3311 honored; sign-in, providers and CSRF returned 200; protected routes redirected to sign-in |
| Signals | Next completed graceful cleanup: SIGTERM exit 143 in 0.355 s, SIGINT exit 130 in 0.397 s; expected Next signal exits, no forced kill |
| Operations and direct Prisma CLI | Passed; non-root postgres retained; direct Prisma version/deploy/status exercised against disposable fixtures |
| PostgreSQL/gosu | pg_dump/pg_restore/psql 17.11; gosu 1.19 hash unchanged, named/numeric user switching passed |
| Backup/restore | Passed using the final operations image: verify-full TLS, read-only role, clean restore, expected nonempty-target refusal, restored data/status and temp cleanup; fixture object store, no live Spaces |
| Security policy | Both image gates and dependency gate passed; zero blockers; no policy/assessment/exception change |
| Artifacts | Both CycloneDX 1.7 SBOMs and SARIF 2.1.0 files passed official schemas; dependency references valid; 19 security artifacts had no configured credential-value matches |
| Candidate consistency | Full release final source fingerprint passed; final whitespace check recorded separately |
| Clean release / hosted CI | Still required after an authorized commit/push. Ordinary release check correctly refuses the dirty tree; full `--allow-dirty` run reports NOT READY by design |

The first full release run stopped in migration compatibility checks with Docker ENOSPC. Only four disposable npm-upgrade review images were removed, recovering about 1.3 GB; the final candidates, existing application images, containers and all volumes were retained. The complete existing release pipeline was then rerun. The initial sandboxed subprocess tests could not run correctly; the authorized unsandboxed focused run and complete suite passed. The direct Prisma version probe needs the existing DATABASE_URL config even without a connection; it passed with an inert local fixture URL and networking disabled. The initial shutdown harness incorrectly expected zero; inspection of the pinned Next source established its explicit 143/130 exits, and both reruns asserted completed cleanup. No application workaround was added.

### Final security results

Each of CVE-2026-109383 / GHSA-2m5v-pch6-74hx, CVE-2026-109869 / GHSA-xjj6-f33q-929c and CVE-2026-87018 / GHSA-qrxm-fqhp-jwvm changed from **one occurrence to zero in each image**. The entire npm tooling closure (148 package inventory records per image) was removed; no other packages were added or removed, and retained inventory versions did not change. No application/recovery lockfile changed during this final remediation.

| Image | Targeted High before → after | All findings before → after | Remaining Critical | High | Medium | Low | Unknown | Policy blockers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Production | 3 → 0 | 237 → 231 | 1 | 56 | 87 | 85 | 2 | 0 |
| Operations | 3 → 0 | 409 → 403 | 3 | 69 | 157 | 168 | 6 | 0 |

The six removed findings per image comprise the three targeted High advisories and three npm-tooling Medium findings. These are not vulnerability-free images. Remaining Criticals are zlib1g CVE-2023-45853 in both, plus libsqlite3-0 CVE-2025-7458 and libxml2 CVE-2026-6653 in operations; Trivy reports no fixed version for these occurrences. Full remaining findings stay in the policy reports/SARIF. Trivy 0.76.1 used its current cached database (updated 2026-10-30 19:07:50 UTC).

Fresh npm audits: app full **16 Moderate, zero High/Critical**; app production **zero**; recovery full and production **zero**. The Moderate findings derive from minimatch GHSA-g3hv-75wg-m249 / CVE-2026-118764 through development lint dependencies (18 expanded policy entries, zero blockers). Follow up separately through dependency maintenance; no audit fix or vulnerability exception was used.

### Final candidate and rollback

This candidate is appropriate for review/commit. It is **not yet release-ready**: the clean committed `release:check` and hosted CI remain outstanding, and no commit/push was authorized or performed. Before any future authorized rollout, update external npm-based runtime/pre-deploy overrides to the documented direct Node commands. No DigitalOcean settings were changed here.

Rollback remains a reviewed revert of the full toolchain/Docker/CI/manifests/locks change, followed by rebuild and validation of both images. Restore the matching runtime commands with the selected revision, keep Node 22.23.4, Prisma 6.19.3 and the existing gosu remediation, and rescan the rebuilt images. **No database rollback is required.**

Suggested commit after review:

`build(toolchain): upgrade to npm 12.2.1 and remove npm from runtime images`

### Exact final candidate file inventory

- `.github/workflows/ci.yml`
- `.github/workflows/security.yml`
- `app/.npmrc`
- `app/Dockerfile`
- `app/Dockerfile.operations`
- `app/docs/backup-restore-rollback-v1.md`
- `app/docs/browser-e2e.md`
- `app/docs/dependency-container-security-v1.md`
- `app/docs/deployment.md`
- `app/docs/document-attachments.md`
- `app/docs/hosted-ci.md`
- `app/docs/npm-12-toolchain-upgrade-v1.md`
- `app/docs/production-cleanup-audit.md`
- `app/docs/release-checklist.md`
- `app/docs/support-email-rollout.md`
- `app/package-lock.json`
- `app/package.json`
- `app/scripts/ci-preflight.mjs`
- `app/scripts/operations/recovery-runtime/package-lock.json`
- `app/scripts/operations/recovery-runtime/package.json`
- `app/scripts/release-check.mjs`
- `app/scripts/security/scope.mjs`
- `app/tests/ci-contract.test.mjs`
- `app/tests/release-check.test.mjs`
