# Dependency & Container Security v1

Current runtime packaging supersedes the historical inventory below: [npm 12 Toolchain Upgrade v1](npm-12-toolchain-upgrade-v1.md) removes npm tooling from both final images, starts Next directly with Node, and keeps npm 12.2.1 in development/build/CI. Historical npm-start and bundled-npm findings below describe the earlier images, not current runtime requirements.

SalesHub monitors dependencies and final Docker images in GitHub Actions. Nothing scans the running CRM, connects to its database, runs a backup/restore, or changes a deployment. Database migrations: **none**. The implementation is on `security/dependency-container-scanning-v1`; activation requires normal review and merge, plus the manual settings below.

The [gosu remediation validation](#gosu-rebuild-remediation-2026-10-29) supersedes the operations failure in the historical baseline below: the rebuilt operations image now passes the unchanged security policy.

## Architecture and release integration

| Surface | PR to main | Main | Weekly / manual |
| --- | --- | --- | --- |
| Standard CI | Existing full check | Existing full check | Unchanged; not scheduled |
| Migration validation | Existing scope and check | Existing full check | Unchanged; not scheduled |
| Dependency Security | App/recovery manifests, lockfiles, security configuration or workflow changes | Both lockfiles | Both lockfiles |
| Production Docker build + Container Security | Runtime/build/security inputs; documentation and test-only PRs skip the expensive steps and succeed | Always; scan the image built by the existing job | Separate isolated build and scan |
| Operations Container Security | Operations Dockerfile, recovery dependencies/scripts, Prisma inputs, Docker context exclusions, security configuration/workflows | Always | Always |

`.github/workflows/ci.yml` retains **Standard CI**, **Migration validation**, and **Production Docker build**. The production job builds **once**, verifies the existing Node/Prisma requirements, then scans that local final image through `.github/actions/scan-image`. There is no second production build or inter-job image handoff on main/PR. `.github/workflows/security.yml` owns dependency and operations scans, and production rescanning on Monday at **08:23 UTC** or manual dispatch. Each job gets a fresh GitHub-hosted Ubuntu runner. There is no Docker Compose invocation, production environment, remote host connection, registry push, or deployment action.

Production uses `docker build --pull --target production … ./app`. Operations uses `docker build --pull -f app/Dockerfile.operations … ./app`, whose default final stage is the operations runtime. `--pull` refreshes metadata for the existing tags; it does not change Dockerfile pins. A scheduled run rebuilds the current default-branch image with current base metadata and scans against the current advisory database. It does **not** attest that a particular deployed digest was scanned; deployment-digest verification/attestations are deferred.

Keep all existing required checks and review rules. Chad should additionally require **Dependency Security** and **Production Docker build** on main; require **Operations Container Security** for the repository if desired (irrelevant PRs succeed without building). Never give Dependabot a bypass. The operation-specific failure should hold an operations release; it need not hold an unrelated app PR. GitHub required-check/ruleset settings cannot be established by these YAML files. Existing DigitalOcean auto-deploy behavior is unchanged: a main scan is release evidence, not a new deployment gate. PR checks must be required and reviewed before merge for automated blocking to protect that release process.

## Before/after audit and GitHub settings

Before this change, the repository contained only `ci.yml` under `.github`: no Dependabot, dependency review, container scan, SBOM, secret-scanning workflow, CodeQL workflow or SARIF uploader. `npm ci` printed npm's audit summary but did not block on vulnerabilities; there was no explicit audit policy. No package/lockfile, Docker base, application code, production configuration or permissions were changed here.

Repository contents establish workflow/configuration behavior. They do **not** establish dependency-graph state, enabled alerts/updates, subscription entitlements, notification delivery, branch protection, or GitHub-managed scanning. Authenticated GitHub repository/settings access is unavailable in this workspace (no `gh` or configured GitHub API credentials). All UI settings and private-repository Code Security/Secret Protection availability remain **unverified**; do not interpret absence of YAML as proof a GitHub-managed feature is disabled.

Chad's checklist: **Repository → Settings → Advanced Security / Code Security** (GitHub may label the section **Security → Advanced Security** or **Code security and analysis**):

- Enable **Dependency graph**. Check **Insights → Dependency graph** for both app and recovery-runtime manifests/lockfiles. Reconcile omissions, especially the direct SheetJS URL dependency.
- Enable **Dependabot alerts** and **Dependabot security updates**. Basic Dependabot alerts support private repositories; security updates can create remediation PRs. These are manual repository settings, not enabled by `dependabot.yml`. See [GitHub security features](https://docs.github.com/en/code-security/getting-started/github-security-features) and [security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates).
- Enable **malware alerts**, if offered for this repository/account. Confirm the capability instead of assuming coverage for every package or direct tarball.
- Keep **grouped security updates** disabled in the UI if offered, so security remediation remains independently actionable. This YAML groups **version updates only**.
- Inspect **Code scanning / GitHub Code Security** entitlement and enable it if available. Do not purchase or depend on a private-repository paid feature merely to run this build.
- Inspect **Secret Protection / Secret scanning**, including push protection, and enable supported features. Private-repository secret scanning availability can depend on entitlement and organization policy. Never upload a real production secret as a test. See [managing repository security settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository).
- Confirm security-manager/admin access and alert notification delivery; configure user notifications as described below. YAML cannot subscribe Chad to email.

## Dependabot configuration

`.github/dependabot.yml` checks npm `/app` weekly, with at most **3 version PRs**. Routine production and development patch/minor updates are grouped separately. Next/eslint-config-next, Prisma CLI/client, and React/react-dom get alignment groups. `next-auth` updates remain individual because they use a prerelease. Major updates stay individual; there is no ignore rule suppressing them. Existing exact runtime/framework pins and CI alignment checks still require human review when Dependabot proposes a version change.

The recovery-runtime npm manifest has its own weekly entry and **1 version PR** limit. GitHub Actions updates have a separate weekly entry and **2 version PR** limit, never grouped with app dependencies. There is no auto-merge, approval bot, privileged PR trigger or protection bypass. Lockfiles and action changes require the same CI, human review and normal release process as other changes.

Security remediation is not tied to the weekly version schedule. The groups explicitly apply to `version-updates`; GitHub uses a separate security-update PR limit. See [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference). Verify automatic handling of the SheetJS CDN tarball manually: neither registry audit nor Dependabot version updates guarantee coverage for arbitrary URL dependencies.

## Dependency detection, evidence and triage

`node app/scripts/security/dependency-audit.mjs` queries `npm audit --package-lock-only --ignore-scripts --json` and the production-only equivalent for **both** lockfiles. It needs no app dependency installation or lifecycle scripts. Registry/tool/schema failures fail the scan rather than reporting a false clean result. Normal npm finding exit code 1 is parsed and evaluated by SalesHub policy, not treated as an unconditional build failure.

The artifact retains full audit JSON and a normalized policy report: advisory, installed package/version, severity, fix availability, affected range, affected lockfile location, representative dependency paths per root, direct/transitive relationship, production/dev/operations scope, assessment and decision. A dev dependency shared with production is treated as production when present in the production-only audit. Parent aggregate upgrade information is reported; the child's advisory carries the gate. Audit evidence alone cannot prove that a package is in the final image or that a code path is reachable: compare the image JSON/SBOM and record a reviewed assessment.

| Class | Assessment and release policy |
| --- | --- |
| Direct production | Review manifest usage, advisory, final-image inventory, request/task/CLI entry point and attacker input |
| Transitive production | Trace the vulnerable copy through the lockfile paths to the direct dependency; assess the affected functionality, not just its parent |
| Direct development | Normally report; inspect CI/build/test access, package scripts, untrusted input and credential exposure before calling it harmless |
| Transitive development | Trace the actual build/test path and install-time exposure; a dev classification alone is not an exemption from review |
| Critical / High production or operations npm | Release blocking while exposure is unknown, reachable or materially exposed. A dated, evidenced **unreachable** assessment clears it without a risk exception. Critical must be fixed or have an approved temporary exception when exposed. High gets prompt review; no blanket dev-only High gate |
| Critical / High development npm | Report by default; block when an assessment identifies reachable/material exposure |
| Medium / Low | Report and track; normally nonblocking. An assessment can set `releaseBlocking: true` for specific material exposure |
| No fixed version | Report that fact. Exposed significant npm findings still need mitigation/temporary exception; do not claim `npm audit fix` can solve an unfixed advisory |

This deliberately requires triage of new production High/Critical npm findings; it does not fail every dev-tool advisory with `npm audit --audit-level=high`. Review significant alerts within **2 business days**, Critical exposure immediately, and assign an owner. Record affected API/code path, whether SalesHub calls it, attacker-controlled input, authentication/network boundaries, actual image presence, fix version, mitigation and next review date. Authentication reduces exposure but does not prove unreachable. Dependabot JavaScript/TypeScript reachability information, where available, is supporting evidence, never the sole decision. Track Medium/Low in the repository's normal security backlog.

## Container policy and SBOM

Aqua Trivy scans the **final local image**, OS **and** library packages. Secret/misconfiguration scanners are not invoked. All severities and unfixed vulnerabilities remain in JSON and SARIF. The scan action returns findings with exit code 0; `app/scripts/security/policy.mjs` then applies the release gate after evidence generation. A scanner/database/tool failure still fails the check.

- **Fixed Critical**: blocking for production and operations images, unless an approved expiring exception matches the exact advisory, package, installed version, severity and scope.
- **Unfixed Critical**: retained and reviewed; nonblocking by default to avoid a permanent base-image deadlock. Block if the assessment establishes material/reachable exposure; then mitigate or approve a temporary exception.
- **High**: report and promptly triage. Initially nonblocking unless assessed reachable/materially exposed. This applies to OS and bundled tooling as well as application libraries.
- **Medium/Low/Unknown**: visible and tracked. A specifically justified `releaseBlocking` assessment may promote a finding to a blocker.

There is no `ignore-unfixed` filter, blanket CVE allowlist or `.trivyignore` suppression. JSON is the complete scan; summary tables show at most 40 findings, with blockers first. Vendor severity/status and scanner version/database date must be considered during triage.

The same inventory is converted offline to **SARIF** and **CycloneDX JSON** (`sbom.cdx.json`). All packages are requested, including nonvulnerable and transitive packages; the SBOM contains versions and dependency relationships. No second scan/image build is needed. Artifacts remain private to authorized repository Actions users and expire after **14 days**, on success and failure. Retention is not a permanent compliance archive. No public registry upload, dependency snapshot write, public SBOM publication or artifact attestation is introduced. GitHub also offers [dependency-graph SPDX export](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/exporting-a-software-bill-of-materials-for-your-repository); that complements but does not replace image inventory.

Only explicit security-report JSON/SARIF/Markdown paths are uploaded. The image context excludes `.env*`, local reports and test evidence. Builds receive no secret build arguments, GitHub production secrets or SSH credentials. Security jobs have no environment dumps or app configuration variables, and operations scanning never starts the backup entrypoint. Never put database URLs, auth/OAuth secrets, Spaces/backup credentials, CA private material or customer data in policy evidence/artifacts. Existing standard-CI dummy test values remain confined to standard CI. Public registry queries necessarily disclose the dependency set to the advisory service; no production data is involved.

## Optional GitHub integrations

The useful default is Actions summaries and 14-day machine-readable artifacts. **No paid feature is required.**

After verifying Code Scanning support in the repository UI, Chad may set **Settings → Secrets and variables → Actions → Variables → `SECURITY_SARIF_ENABLED=true`**. Separate publication jobs download only evidence, have no checkout or production secrets, and get `contents: read`, `actions: read`, `security-events: write`. Other jobs retain `contents: read`. Publication runs only for main/scheduled/manual scans, including failed gates. Upload rejection due to plan/access/settings produces a summary fallback and does not erase evidence or change the scan gate. Fork and Dependabot PRs do not receive a security-events write publisher.

There is no CodeQL source analysis introduced; the CodeQL action is used only as GitHub's SARIF transport. Existing GitHub-managed code scanning state is unverified.

After confirming **Dependency graph** and private-repository **GitHub Code Security / Dependency Review** support, Chad may set `SECURITY_DEPENDENCY_REVIEW_ENABLED=true`. The optional PR action is advisory (`warn-only`, no PR comment permission, unsupported API failures tolerated). Severity alone there cannot override the reachability policy. If unavailable, leave it unset: use Dependabot, human lockfile review, npm audits and required CI. See [GitHub dependency-review availability](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository).

## Exceptions and assessments

`app/security/vulnerability-policy.json` contains separate `assessments` and `exceptions` arrays, initially **empty**. Documentation of the baseline is not a waiver. There is no database table or application UI.

Every entry must record `advisory` (CVE/GHSA), `package`, `installedVersion`, lowercase `severity`, `relationship` (`direct`, `transitive`, `os`, `bundled`), `scope` (`production`, `development`, `operations`), `exposure` (`reachable`, `material`, `unreachable`, `unknown`), `evidence`, `mitigation`, `owner`, `reviewedAt` and `expires` (UTC dates). Evidence should include actual image/package path, affected functionality, input route and authentication/network boundaries. For material Medium/Low exposure, an assessment may include boolean `releaseBlocking: true`.

Use an assessment to document reachability. Use an **exception** only to accept a finding that would otherwise block, with a clear owner, remediation plan and reviewed mitigation. Open a normal PR and require the designated security owner/reviewer to approve. Prefer **7–14 days**. The validator requires a positive lifetime of at most **90 days**; no indefinite entries. Expiration is inclusive through the specified UTC date, and expired entries cannot suppress findings. Exact advisory/version/severity/scope matching prevents a waiver from silently covering a new version or different runtime. CI does not renew or auto-create exceptions. Review at expiration, delete after remediation, and rerun all required checks. Fixed Critical image findings cannot be cleared by a mere unreachable assessment; they require remediation or a reviewed exception.

## Alerts, response and remediation

GitHub is authoritative. There are no SalesHub email notifications. Open **Profile → Settings → Notifications** and configure Dependabot alert delivery; the Dependabot pages also offer a **Manage notifications** dropdown. Choose email/web delivery and an appropriate verified email; use the repository's **Watch → Custom → Security alerts** option where offered. Confirm settings for a user with the appropriate repository/security permissions. See [Dependabot notification configuration](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependabot-notifications).

Dependency alerts appear at **Repository → Security / Security and quality → Dependabot**. CI and container failures appear in **Actions / PR checks**; watch Actions workflow failures and read the scan summary/artifacts. With SARIF enabled, container findings also appear in Code scanning. Scheduled failures do not automatically create Dependabot alerts, issues or emails from SalesHub. Chad should review weekly scan results and promptly assign significant findings, even when the gate is green.

For a new Dependabot alert:

1. Inspect severity, advisory details, affected range and fixed version (or absence of one).
2. Determine production/dev, direct/transitive and the vulnerable installed copy/path; compare final-image evidence.
3. Assess functionality, attacker-controlled input, authentication/network constraints and actual reachability. Record evidence and owner.
4. Create or review a narrowly scoped remediation PR. Do not run `npm audit fix --force` indiscriminately. Treat action/runtime upgrades and paired Next/Prisma pins as compatibility changes.
5. Run the same required CI and security checks as a normal release.
6. Merge through the normal reviewed process, with no Dependabot bypass or automatic merge.
7. Verify the alert closes and the image scan is clean for the affected advisory; remove obsolete assessments/exceptions.

For a container scan failure:

1. Inspect artifact JSON/SARIF for advisory, package, version, path/layer, image ID and vendor status.
2. Determine whether the fix applies to this distribution/version; absence of `FixedVersion` is not a remediation.
3. Determine runtime relevance: OS library versus app dependency versus bundled CLI/Go executable. Inspect actual invocation and attacker input.
4. Patch the dependency or propose a compatible base refresh/removal of an unnecessary component in a separate reviewed PR. Refreshing a Node/npm toolchain must retain Prisma/native-library compatibility; PostgreSQL tooling changes need recovery testing.
5. Rebuild the same final target and rerun scans, SBOM generation and required CI.
6. Document a short temporary exception only when justified, with mitigation and a deadline. A failed operations check should not be represented as a clean baseline.

If investigation shows exploitation or leaked credentials, contain the affected service/credential through the existing incident process, rotate credentials through the provider, preserve restricted evidence and verify remediation. Do not put secrets or customer data in issues, scan artifacts or exception records.

## Action trust and base-image review

Existing `actions/checkout@v7`, `actions/setup-node@v7` and `actions/upload-artifact@v7` remain on the project's stable-major policy. Added `actions/download-artifact@v8` is also GitHub-maintained. Dependabot proposes action updates separately. Prefer reviewed full commits for third-party actions; do not use `latest` or floating development branches.

The only scanner is **Aqua Security Trivy**: `aquasecurity/trivy-action` **v0.36.0**, pinned to `ed142fd0673e97e23eac54620cfb913e5ce36c25`; CLI explicitly **v0.76.1**. Aqua maintains the scanner/action. Its composite setup/cache action references are also commit-pinned; cache is disabled here so each isolated job obtains current DB evidence. Optional GitHub Dependency Review **v5.0.0** and GitHub SARIF upload **v4** are pinned to full commits. Review the upstream diff and nested actions before accepting Dependabot updates; repository pins do not make mutable downloaded vulnerability data immutable. See [Trivy action source](https://github.com/aquasecurity/trivy-action/tree/ed142fd0673e97e23eac54620cfb913e5ce36c25) and [Trivy report conversion](https://trivy.dev/latest/docs/configuration/reporting/).

| Docker stage/image | Base and OS | Runtime review |
| --- | --- | --- |
| Development (not the production scan target) | `node:22.23.4-alpine`, Alpine family | Existing dev image; not mislabeled as production evidence |
| Production base/final | `node:22.23.4-bookworm-slim`, Debian 12 Bookworm | Adds only OpenSSL and CA certificates; production-only npm install, built Next output, Prisma/schema/migrations and existing operational/seed scripts. Runs as `node`. The build-stage node_modules tree is not copied |
| Operations | Node copied from `node:22.23.4-bookworm-slim` into `postgres:17-bookworm`, Debian 12 | PostgreSQL client/recovery tools and locked recovery npm dependencies. Runs as `postgres`; inherited entrypoint cleared. Includes upstream PostgreSQL server packages and `gosu` beyond the invoked recovery tools |

The production image is not a minimal/distroless image: upstream npm/tooling remains, and `npm start`/Prisma are existing runtime requirements. Inventory confirms TypeScript **5.9.3** in both images' production closure, despite its root dev declaration: npm can retain peer/transitive dependencies of runtime tooling. Therefore `--omit=dev` is not proof that a package is absent; use the image inventory. ESLint and Playwright are absent from these inventories. A client-only operations image would require separating the existing restore drill, which starts the bundled PostgreSQL server and uses its `gosu` privilege-drop path. Do not delete `gosu` while that drill still depends on it. No base/package refresh or removal was silently included here. Node tags pin the Node patch, but OS contents remain mutable; PostgreSQL pins major 17, not its patch. Current resolved base digests and final-image identities are recorded in the baseline evidence.

## Fresh baseline, limitations and cost

The fresh baseline below is from **2026-10-29**, using the current lockfiles, current Trivy DB and the exact Docker targets above. It supersedes the historical October 27 audit paragraph in Hosted CI documentation. The machine-readable snapshot is [baseline-2026-10-29.json](../security/baseline-2026-10-29.json); complete local JSON/SARIF/SBOM/log evidence is under ignored `app/reports/security-baseline/`, not committed or published publicly.

| Scan | Critical | High | Medium | Low | Unknown | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| npm full app | 0 | 0 | 0 | 0 | 0 | Pass |
| npm production app | 0 | 0 | 0 | 0 | 0 | Pass |
| npm recovery runtime (full + production) | 0 | 0 | 0 | 0 | 0 | Pass |
| Final production image | 1 (0 fixed) | 66 (10 fixed) | 97 | 86 | 1 | Pass under v1; findings remain open |
| Operations image | 4 (1 fixed) | 104 (35 fixed) | 197 | 172 | 5 | **Fail: fixed Critical** |

Counts are package/advisory occurrences, not unique CVEs. Trivy and npm audit have different inventory/advisory coverage: a clean app lockfile audit does not clear OS packages, Node's bundled npm, or embedded Go libraries. Neither proves that every possible vulnerability is known.

Initial significant-finding triage (owner: **Chad**, review/assignment due **2026-11-02**; this is a triage deadline, not an exception):

- **CVE-2025-68121**, operations `/usr/local/bin/gosu`, embedded Go stdlib **1.24.6**, Critical with fixes **1.24.13 / 1.25.7 / 1.26.0-rc.3** reported. It concerns Go TLS session resumption ([Go advisory](https://pkg.go.dev/vuln/GO-2026-4337)). Dockerfile sets `USER postgres`, clears the PostgreSQL entrypoint and directly invokes Node recovery scripts; ordinary backup/restore commands do not invoke `gosu`. However, `scripts/operations/restore-drill.mjs` explicitly starts this image as root and invokes `docker-entrypoint.sh postgres`; the inherited entrypoint executes `gosu postgres` to drop privileges. The binary is required by that existing drill. No affected Go TLS execution path has been demonstrated, and invoking `gosu` for privilege dropping is not itself evidence of TLS vulnerability reachability. The fixed Critical image gate remains failing with no exception or suppression. Prefer a separate, narrowly scoped binary rebuild/replacement with a patched Go toolchain, preserving drill behavior; see the verified root cause below.
- **CVE-2023-45853**, both images' `zlib1g` **1:1.2.13.dfsg-1**, Critical, no fix reported for this package; Trivy status `will_not_fix`. [Debian's tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853) explains that the affected contrib/minizip code is not built into the old zlib binary packages. This supports low runtime relevance for this specific reported binary; preserve the report and revisit vendor status. No ignore/exception is needed for the initial unfixed gate.
- Operations **CVE-2025-7458**, `libsqlite3-0` **3.40.1-2+deb12u2**, and **CVE-2026-6653**, `libxml2` **2.9.14+dfsg-1.3~deb12u6**: Critical without reported fixes (`affected` / `fix_deferred`). The recovery path invokes PostgreSQL clients and Node, not a SQLite application. This is preliminary exposure evidence only; XML/libpq capabilities and inputs still need review. Recovery handles sensitive backup material with credentials at runtime, so limited network exposure does not eliminate risk.
- Both images have **10 fixed High occurrences in bundled npm tooling**, at `usr/local/lib/node_modules/npm/...`: `brace-expansion@2.0.2` (5 advisories), `ip-address@10.1.0`, `pacote@19.0.2` and nested `20.0.1`, `picomatch@4.0.3`, `sigstore@3.1.0`. They are tooling-transitive, present in the image, outside the app/recovery lockfiles. Production executes `npm start`, not an npm package install from attacker-provided archives; operations invokes Node directly. No CRM HTTP request path to the affected tooling was established. Review each advisory's actual affected functionality and startup/build inputs before concluding unreachable; propose a separately tested Node/npm base refresh rather than patching the global npm tree here. Exact advisory IDs/fixes/paths are in the snapshot.
- Remaining significant occurrences include **57 production OS findings** (56 High, 1 Critical), **72 operations OS findings** (69 High, 3 Critical), and **26 operations `gosu` Go-stdlib findings** (25 High, 1 Critical). Review vendor statuses and package/layer relevance before broad OS upgrades. The snapshot records every Critical/High occurrence; the full artifact retains all severities. Most OS High findings have no reported fix. They remain open triage work, not automatically waived by being in a base image.

Measured local timings are recorded with the snapshot. The first production build took about **380 seconds** with dependency/build work and image export; the final `--pull` validation took **163 seconds**, partly cached. Operations' `--pull` build took **2 seconds**, largely cached. Dependency audit of four views took about **5 seconds**. Production scans took **26–33 seconds** with DB already downloaded; operations' warm scan took about **1 second**. The first cold DB download alone took about **12 seconds**. SARIF plus SBOM conversion took **less than 1 second per image** in the final timing. Production SBOM contained **427 components / 518 dependency edges**, operations **412 / 659** in this baseline.

Actual GitHub-hosted runtime/minutes are **not measured**: this task must not push or trigger a remote build. Image jobs write `build-timing.json`, `timings.json` and an Actions scan-timing summary; dependency scans write their audit duration in `timings.json`, so Chad can measure the first hosted run. Main adds one dependency job and one operations build/scan, and reuses the existing production build for scanning; runtime-changing PRs add a production build that Hosted CI v1 previously skipped. Weekly work is four audit queries and one build/scan per image. Fresh hosted runners may take longer than warm local measurements, especially image export and DB downloads. No image artifact transfer, redundant scanner, test multiplication, or production access is used to reduce minutes.

The continuous baseline is reasonable once merged, required checks configured and basic Dependabot settings enabled. It intentionally surfaces existing image debt. It is **not a clean security bill**: operations has a real failing policy finding, private GitHub integrations/notifications remain unverified, URL dependencies need manual coverage review, and significant findings require ongoing human triage.

## Pre-commit verification of CVE-2025-68121

The final operations scan and the cached upstream base agree on the following evidence:

| Item | Verified value |
| --- | --- |
| Executable | `/usr/local/bin/gosu` |
| Actual executable version | `1.19 (go1.24.6 on linux/amd64; gc)` |
| Trivy Go module identity | `github.com/tianon/gosu@v1.19.0`; affected package `stdlib@v1.24.6`, advisory `GO-2026-4337` |
| Introducing base | `postgres:17-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5` |
| Introducing layer digest | `sha256:b64d8a47f0d19343ba718f6ad53bed45c99f029b829d56667ac8b07f86f8e59d` |
| Uncompressed layer DiffID | `sha256:d40ea06b694d9945f1a3cde92fa80d1aa33b125797aaf6e9ee554cfb4402e0bd` (fourth filesystem layer, zero-based index 3) |
| Introduction mechanism | PostgreSQL's base-image `RUN` downloads and signature-verifies the upstream `GOSU_VERSION=1.19` executable. Node's copied runtime does not introduce it |
| APT ownership | `dpkg-query -S /usr/local/bin/gosu` finds no owning package: this is a manually installed upstream binary |

[PostgreSQL's upstream Dockerfile](https://github.com/docker-library/postgres/blob/master/17/bookworm/Dockerfile) installs `gosu` for dropping from root to the database user. The cached base's actual entrypoint calls `exec gosu postgres ...` when started as root. SalesHub's normal Node operations command avoids this path, but the existing [restore drill](../scripts/operations/restore-drill.mjs) overrides the user/entrypoint and depends on it. A one-line removal would break that recovery validation path.

There is no verified drop-in fixed binary in the current base. Trivy's fixed versions describe the **embedded Go standard library**, not PostgreSQL or an APT upgrade. As checked on 2026-10-29, the latest upstream [gosu 1.20 release](https://github.com/tianon/gosu/releases/tag/1.20) is also built with **Go 1.24.6**; changing only gosu 1.19 → 1.20 does not clear this toolchain finding. The available [Bookworm amd64 package](https://packages.debian.org/bookworm/gosu), **1.14-1+b10**, was separately downloaded, checksum-verified and inspected: its executable reports **Go 1.19.8**, installs at `/usr/sbin/gosu`, and is not a verified fix for the manually installed `/usr/local/bin/gosu`. Installing or upgrading a system Go package does not rewrite the compiler/runtime embedded in an existing executable.

The smallest behavior-preserving remediation is to replace only `/usr/local/bin/gosu` with the same reviewed gosu source rebuilt using a pinned, currently supported Go release containing the TLS fix. Pin source/compiler inputs and verify the resulting binary; keep the compiler in a build stage. Preserve the PostgreSQL base, privilege-drop interface, Node runtime and recovery scripts. Rebuild/scan the final operations image, assert the binary's version and user-switch behavior, and run backup/restore regressions plus the disposable restore drill before accepting it. A verified upstream patched binary could replace a local rebuild when one becomes available. Removing `gosu` instead requires redesigning and validating the drill's startup/privilege-drop path; a client-only base change is broader still. This review does not implement those runtime changes.

The [gosu security policy](https://github.com/tianon/gosu/blob/1.20/SECURITY.md) cautions that Go compiler-version findings can involve interfaces the executable does not use. That is supporting reachability context, not a waiver: no exception, VEX, ignore entry or gate weakening was added. The existing finding remains visible and blocking.

## gosu rebuild remediation (2026-10-29)

`Dockerfile.operations` now replaces only `/usr/local/bin/gosu` in the final operations runtime. A separate build stage compiles the unchanged [gosu 1.19 source](https://github.com/tianon/gosu/tree/6456aaa0f3c854d199d0f037f068eb97515b7513), commit **6456aaa0f3c854d199d0f037f068eb97515b7513**, using **Go 1.26.10**. This is a supported release containing the [TLS fix](https://pkg.go.dev/vuln/GO-2026-4337) and subsequent [Go security fixes](https://go.dev/doc/devel/release#go1.26.10). No PostgreSQL startup, restore-drill, dependency manifest, lockfile, production Dockerfile or vulnerability-policy change is included.

Build inputs and provenance:

- Builder: `golang:1.26.10-bookworm@sha256:23ce71337b726608afb1bc00986e630a05034a87a87ea1fc2cd1ae5cf33387eb` (multi-platform index). The stage uses Docker's target platform by default; validated here on **linux/amd64**. Other architectures were not executed locally.
- Source module: `github.com/tianon/gosu@v0.0.0-20250923190938-6456aaa0f3c8`, the canonical Go module version of tag `1.19`'s exact commit. The upstream tag lacks Go's `vX.Y.Z` spelling; the pseudo-version preserves a truthful version/commit in executable metadata and the SBOM while `gosu --version` still reports **1.19**.
- Source checksum: `h1:HIpXk5mGBQGfOqcaBbRT4Vnss8NPICnMGlD5xTlPBdQ=`. Go authenticates modules through `sum.golang.org`; the build additionally asserts this pinned checksum before compilation. Dependencies remain the upstream pinned `github.com/moby/sys/user@v0.1.0` and `golang.org/x/sys@v0.1.0`. No prebuilt gosu binary is downloaded.
- `GOTOOLCHAIN=local` prevents compiler substitution, `CGO_ENABLED=0` produces a static executable, and `-trimpath` removes build-directory variation. The upstream `-ldflags='-d -w'` convention retains symbols for vulnerability analysis. Only `/out/gosu` is copied into the final image, at mode **0755**, after the existing runtime layers.
- Final binary: `1.19 (go1.26.10 on linux/amd64; gc)`, SHA-256 **9808d660017e4cf5edcac898bfd83a922e0b65db945fabb6d868e060493ef6af**. An independent offline compilation with an empty compiler cache produced identical bytes. Runtime checks confirmed no Go compiler, Go module cache, source tree or GCC executable.

The final runtime retains **Node 22.23.4**, **Prisma CLI/client 6.19.3**, and **PostgreSQL tools 17.11**. Inventory outside the gosu executable is unchanged. Named-user switching, numeric `12345:23456` UID/GID switching, and postgres supplementary groups passed. A disposable, network-isolated container started through `docker-entrypoint.sh postgres` as root reached a PostgreSQL PID 1 with all UID/GID fields **999**, explicitly proving the inherited gosu privilege-drop path.

The existing, unchanged disposable restore drill passed against the final executable. Its fixed local image tag was temporarily pointed at the rebuilt image and restored in a `finally` block. Verified TLS, read-only source-role enforcement, actual `pg_dump`/archive parsing, fresh restore, nonempty-target refusal, confirmed clean restore, Prisma table counts/relationships/sequences/migration status and temp cleanup passed. The fixture uses synthetic data and in-memory object storage; it does not establish live Spaces access or production RTO. Both disposable validation containers were removed.

Trivy **0.76.1**, using the same **2026-10-29** database and all severities, produced this comparison of final operations images:

| Finding occurrences | Before | After |
| --- | ---: | ---: |
| Critical | 4 | 3 |
| Fixed Critical / blockers | 1 | **0** |
| High | 104 | 79 |
| Medium | 197 | 167 |
| Low | 172 | 169 |
| Unknown | 5 | 5 |
| Go stdlib findings | 59 | **0** |
| Total | 482 | 423 |

**CVE-2025-68121 is absent; the operations gate passes.** There are **59 removed findings and zero new findings**, comparing advisory/package/version/location identities with the image-name portion of the OS target normalized. All remaining findings are retained; no exception, ignore entry, VEX statement, severity filter or policy weakening was added. The three remaining unfixed Criticals are the same `libsqlite3-0` CVE-2025-7458, `libxml2` CVE-2026-6653 and `zlib1g` CVE-2023-45853 described above.

The gosu inventory still reports two **pre-existing dependency findings**: CVE-2026-61801 in `github.com/moby/sys/user@v0.1.0` (Medium; fix 0.4.1), and CVE-2026-39824 in `golang.org/x/sys@v0.1.0` (Unknown; fix 0.44.0, Windows-specific advisory). Neither is a new finding or a Go stdlib finding. They remain visible for separate triage; dependencies were not broadened into this compiler-only remediation.

The final scan generated CycloneDX **1.7** with **412 components / 659 dependency edges**, and SARIF **2.1.0**. Validation checked document structure, versioned package components including gosu's exact source module and stdlib, unique component references and resolvable dependency edges. Trivy also emits an unversioned application grouping for the executable path; its gosu and stdlib package children carry their versions. All **25 backup/restore safety tests + 10 security CI contracts** passed against the final Dockerfile. Full lint, typecheck and `git diff --check` passed. The initial sandbox test attempt could not spawn required children (`EPERM`); the unrestricted rerun passed without test changes.

Production inputs were unchanged, and before/after scans of the retained `bixolon-crm-dependency-security-v1:local` image have identical findings and a passing policy result (zero fixed Criticals/blockers). **Limitation:** that retained image predates the exact reviewed baseline image, which is no longer available locally. An additional fresh production-target build failed Debian APT signature verification. Therefore this validation proves unchanged findings for the retained production image and unchanged production inputs; it does not claim a successful fresh production rebuild or a rescan of the removed baseline image.

The [remediation snapshot](../security/gosu-remediation-2026-10-29.json) records exact source/compiler/image identities and results. Full local build, runtime, reproducibility, drill, JSON/SARIF/SBOM, policy and test evidence is under ignored `app/reports/gosu-remediation/`. The earlier baseline remains a historical record. No commit, push, merge, deployment, DigitalOcean change or production-data operation was performed.

Suggested remediation commit: `fix(security): rebuild operations gosu with pinned Go 1.26.10`.

## Implementation files and validation

| File | Change |
| --- | --- |
| `.github/dependabot.yml` | Weekly app/recovery/Actions update configuration |
| `.github/workflows/ci.yml` | Preserve existing checks; scope PR production builds and scan their final image |
| `.github/workflows/security.yml` | Dependency/operations checks, weekly and manual rescans, optional dependency review |
| `.github/workflows/security-sarif.yml` | Isolated optional SARIF publication with artifact/summary fallback |
| `.github/actions/scan-image/action.yml` | One pinned Trivy scan, conversions, policy, timing and bounded evidence |
| `app/scripts/security/dependency-audit.mjs` | Locked audit collection, dependency paths/scope and policy evaluation |
| `app/scripts/security/policy.mjs` | Finding normalization, dated assessments/exceptions, decisions and summaries |
| `app/scripts/security/scope.mjs` | PR changed-file scope; main/scheduled/manual always scan |
| `app/security/vulnerability-policy.json` | Empty assessment/exception register |
| `app/security/baseline-2026-10-29.json` | Current counts, image/base IDs, scanner/DB identity, timings and all significant findings |
| `app/tests/ci-contract.test.mjs` | Extend the existing contracts with eight security regressions |
| `app/docs/hosted-ci.md` | Update production PR behavior and superseded audit baseline |
| `app/docs/dependency-container-security-v1.md` | Architecture, settings, policies, response workflows and completion evidence |

Local validation passed YAML parsing/contracts and actionlint **1.7.12**, full lint, TypeScript, runtime preflight, **1,656 unit/regression tests** with **one existing opt-in SQL test skipped**, and **10 CI contract tests**. The eight new contract cases cover Dependabot grouping/cadence/limits, workflow triggers and preserved checks, PR scope, least-privilege optional integrations, action/scanner pins and evidence handling, dependency reachability/exception expiry, container gate behavior and audit classification/paths. Focused contracts/lint were rerun after final security-script edits.

Both image builds with `--pull` passed. Production Node/Prisma alignment passed; production Webpack build passed with validation-only service settings. Fresh app/recovery full and production npm audits passed with zero findings. Both Trivy scans completed, both SARIF documents parsed as 2.1.0, and both CycloneDX inventories passed checks for package versions and resolvable dependency references. Production policy passed; operations policy intentionally failed on its one fixed Critical. No exception was added to force a green result. `git diff --check` passed. Hosted execution, GitHub UI/notification settings, actual deployment digest and optional paid-feature APIs remain unverified.

The existing complete migration regression harness also passed, including replay, populated preservation, schema parity, compatibility and invalid-data rollback; its temporary database/container/network were removed. An initial compatibility run encountered local Docker `ENOSPC`. A full retry passed after removing the two task-created scan-image tags and 39 task-created build-cache records (2.707 GB of cache). Older cache, existing images, containers and volumes were preserved. JSON/SARIF/SBOM evidence remains under `app/reports/security-baseline/`; the initial capacity failure log is retained as `migrations-initial-enospc.log`. No CI storage-pruning behavior was added.

No commit, push, merge, deployment, branch switch, DigitalOcean change or production-data operation was performed. Suggested follow-up branches (not created): `security/operations-gosu-remediation` for the operations blocker and `security/node-npm-toolchain-refresh` for bundled npm High findings, each with its own compatibility/recovery validation.
