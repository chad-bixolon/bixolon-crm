# Support Email productionization validation

Review preparation against main `1734b01` and the validated POC worktree. Initial port tests used synthetic Gmail, the dedicated disposable `saleshub_e2e` database, or isolated PostgreSQL containers. The subsequent runtime recovery and final P2 validation are summarized below; production and the port-3001 POC were untouched. The current pre-commit inventory contains 71 candidates (32 modified tracked files and 39 untracked files). Nothing is staged, committed or deployed.

## Requirement evidence

| Requirement | Authoritative implementation / validation |
| --- | --- |
| Preserve validated workflows | `app/support/inbox`, Case actions/new/detail, `lib/support-email.ts`; Support Email unit and Playwright workflows |
| Exact Gmail read-only scope | `support-gmail-config.ts`, token exchange/refresh scope verification; injected-adapter tests inspect every request method/path and reject broader scopes |
| Production environment boundaries | Production flag, HTTPS canonical AUTH_URL/callback, exact PostgreSQL identity, TLS and test-mode rejection; configuration unit tests |
| Configurable production callback/dedicated client | `supportGmailCallback`, dedicated Support env values, real-user callback + PKCE/state; callback success/failure/replay tests |
| PostgreSQL encrypted credentials | `SupportGmailConnection`, AES-GCM context/key validation; unit reconnect/disconnect/tamper/copy tests and rolled-back real PostgreSQL round-trip script |
| Forward migrations | `20261013230000_support_email_production`; complete isolated replay, schema parity, populated upgrade, existing Support row preservation and SQL duplicate checks |
| 30-day lookback and 50-message cap | Live query + precise cutoff filter; bounded fixture tests and recent-reply/dormant-thread/quoted-context regression |
| Compact connection management | Inbox status + Manage disclosure, persistent last-successful-read timestamp; responsive queue browser checks |
| Support/Admin permissions | Existing `can` grants, route/mutation/source/import guards, real-user connect/disconnect; denied-role unit and browser checks |
| Signed source integrity | HMAC actor/mailbox/message/thread source and signed file grants; server rereads selected messages/files; tamper/expiry/cross-user/changed-metadata tests |
| Duplicate delivery behavior | `support-email-identity.test.mjs` and browser test retain direct/Group copies with distinct Gmail IDs and one-copy Ignore/Restore |
| Explicit attachments and object storage | Signed explicit selections, existing `documentStorage`/Support upload validation, provenance unique index and lock; import/retry/removed-source/ambiguous-commit tests |
| Description and Note UX | Conditional email Description sizing, five-row `ExpandingTextarea`, CSS height cap/manual resize; responsive intake/note browser assertions/screenshots |
| Support Inbox hierarchy/badges/disclosures | `support-inbox-display`, message actions and disclosure; phone/tablet/desktop browser checks |
| Secrets/runtime documentation | `.env.example`, Compose defaults, `support-email-rollout.md` environment table; no real secret values or POC credential files |
| Google Cloud setup | Dedicated Web OAuth client, Gmail API, exact canonical redirect and read-only scope in rollout runbook, linked official references |
| DigitalOcean rollout | Backup, pre-deploy migration job/one-off image commands, health, connection/identity, controlled Case/attachment checks, Gmail-state comparison and additive rollback |
| No live-Gmail automated dependency | Strict existing E2E authentication DB guard, mock/simulated fixtures; adapters injected with synthetic responses; persistence verification forbids network |
| Full SalesHub regression | Lint/typecheck/all-unit/full Playwright/responsive/production-build/diff gates recorded below |
| Safety/review stop | Final Git HEAD/index/POC worktree comparison; no deploy, commit, production mutation or local real-mailbox connection |

## Initial port gate results

The initial port gates completed before the later Next.js upgrade and P2 changes. Historical evidence:

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS, zero errors/warnings |
| `npm run typecheck` | PASS after final schema/client generation |
| All unit tests, optional SQL enabled on E2E | 1,124 passed; zero failures/skips |
| Full Playwright run | 216 passed; 12 intentional viewport skips; one role-switch failure corrected and rechecked |
| Auth/Support/attachment/textarea recheck | 21 passed; zero failures/skips, including the failed attachment case |
| Responsive browser validation | PASS at phone, tablet portrait/landscape and desktop; Support screenshots reviewed |
| Full migration replay | PASS: fresh/parity, populated upgrade/preservation, repeat deployment, Support sources/duplicates, rejected invalid fixtures |
| PostgreSQL token persistence round trip | PASS in rolled-back E2E transaction; network prohibited |
| Production Docker image / default Turbopack build | PASS with the unchanged production Dockerfile |
| Production image runtime | PASS: non-root, HTTP 200 `/api/health`, network isolated, no published ports or real DB/Gmail configuration |
| Production image migration CLI/history | PASS: 71 migrations, up to date against saleshub_e2e; status only |
| `git diff --check` | PASS |

Host Turbopack attempts were blocked by a CSS-worker local port-binding restriction. The actual deployment Docker image completed the same default `npm run build` successfully, including Prisma generation, compilation, TypeScript and route generation. No bundler or deployment configuration workaround was introduced. The first full unit attempt identified a new page-category omission and a concurrent Prisma generation race; both were resolved, and the complete final rerun enabled the optional read-only prospect SQL fixture against saleshub_e2e and passed **1,124 tests with zero skips**. A focused rerun with expanded permissions and encryption-copy protections passed 41 tests. PostgreSQL credential round-trip passed and rolled back; there were no Google requests.

The migration replay initially exposed pre-existing missing GIN index declarations/truncated Calendar index metadata and a foundation assertion that rejected six later intentional Calendar/preference cascade edges. Prisma metadata now matches the existing SQL, and the integrity check permits only those exact existing edges. No historical migration was edited and no production cascade changed. The entire migration replay finished with **ALL MIGRATION TESTS PASSED**; new Support preservation/duplicate assertions passed.

## Practical limits

Inbox is capped at 50 messages per read with no inbox pagination, background sync, full historical-thread reconstruction or automatic Case/attachment import. Linked-email attachment review has separate bounded paging and exact-source recovery; it does not expand the inbox window or reconstruct the full mailbox. History retained is the body/context of returned or explicitly signed/linked messages. Signature-image filtering is heuristic and recoverable through Reveal. Attachment scanning and automatic orphan-object cleanup remain outside the existing storage policy. OAuth replay claims are per process with PKCE and Google's globally single-use authorization codes; no OAuth token is persisted in browser or process-local files.

Actual production Google consent, hosting, network access, Spaces credentials and unchanged-Gmail smoke checks must be performed during the authorized rollout. They are deliberately not exercised from local development. The runbook provides the controlled verification sequence.

Browser evidence: the full 229-case run completed **216 passed, 12 viewport-specific skips, one role-switch failure**. The failure snapshot showed Read Only after the helper attempted Support login, so Remove was unavailable. The test helper now navigates away before replacing the session, preventing late requests from the prior role; the attachment test also checks write controls before awaiting removal. A fresh **21-test authentication/Support/attachment/textarea rerun passed completely**, including that previously failed case. No application permissions were relaxed. The 12 conditional skips are touch/phone/mobile-filter cases excluded at other breakpoints; their applicable viewport executions passed. Full responsive coverage includes 390×844, 768×1024, 1024×768 and 1440×900.

Captured evidence is under ignored `app/reports/support-email/`: full and focused Playwright HTML reports/logs, unit/migration logs and Support Inbox/intake/Note screenshots. Phone Inbox, desktop email Description and tablet capped Note screenshots were visually inspected in addition to browser layout assertions.

The initial port dependency audit (`npm audit --omit=dev --json`) reported **3 existing package findings: Next.js critical, sharp high, source-map-js high**. The package manifest/lockfile were unchanged at that stage; the subsequent Next.js 16.3.6 upgrade and newer audit evidence are recorded below. The [critical Next.js advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) concerns attacker-controlled SVG passed to Node.js `next/og` ImageResponse; the application source has no ImageResponse/next/og usage. This source check limits that known exposure and is not a blanket assessment of every Next.js advisory. Existing [sharp/librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) and [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) advisories also remain. Review dependency remediation before authorizing deployment; no dependency upgrade was mixed into this Support integration. Full build-time install additionally reports dev dependency advisories. Raw audit evidence is retained with the review logs.

At the initial port review stop, main HEAD remained `1734b01` and the index was empty. The validated POC remains at `b67d445` with its original uncommitted feature inventory. No production/main database migration or mutation, no local real-mailbox connection, no commit and no deployment occurred. Only the disposable E2E database was recreated/migrated/seeded and used for tests; disposable migration containers were removed by their verifier. The locally built review image is retained for inspection.

## Subsequent Next.js validation and authorized local recovery, October 14

The current manifest, lockfile, development image and main app's anonymous dependency volume all contain **Next.js 16.3.6**; `eslint-config-next` is also pinned to 16.3.6. The later full-suite evidence at ignored `app/reports/final-validation-20261014/validation-summary.json` records **219 passed and 10 viewport-specific skips**, with no failures, plus an 11-test attachment recheck. That suite was completed before this recovery verification and was not rerun during it. Its recorded production dependency audit has zero critical findings and three high package findings (Next.js, sharp, source-map-js); the earlier critical advisory is absent. This does not claim that all package advisories were resolved by 16.3.6.

Authorized local runtime recovery preserved the existing database and normal Google login, while keeping Inbox fixtures confined to disposable E2E. Server-specific database mounts stayed in the ignored local override; the repository's portable Compose database default was unchanged. The recovery verified protected backups, existing-data preservation, expected permissions, reviewed migration checksums and no pending migrations. No restore, reset, destructive Prisma operation or direct cluster-file modification was used during that verification. Host identifiers, administrator details, backup metadata and database inventories are retained only as ignored operational evidence under `app/reports/`; they are intentionally omitted here.

Normal Google login, Administration and Support Cases were confirmed. Main exposes only its normal Google authentication provider with E2E authentication disabled. Health checks returned 200, Inbox required authentication, and local rendering explained that live Gmail requires the configured production environment. No live Support Gmail connection was created. The production-only environment guard remains in place.

Historical post-recovery checks passed: runtime lint and typecheck, 19 focused Gmail/Inbox/identity unit tests, and two focused Inbox browser tests. Those browser tests used only the disposable E2E database and synthetic mail. Detailed local recovery evidence remains ignored and must not be staged.

## Final Support Email P2 fixes and validation, October 14

The three reproduced P2 defects are fixed without schema or migration changes:

| Defect | Final behavior and regression evidence |
| --- | --- |
| Older completed messages crowded out new attachments | Linked messages page newest first by saved `messageDate DESC, id DESC`; failed sources page independently. Within each conversation, unresolved failures precede unimported files and then complete/removed imports, before the 200-option cap. Tests cover more than 50 links/failures, bounded older/retry paging and completed-file crowding. |
| Missing linked origin blocked all attachment recovery | Missing, unreadable or identity-mismatched sources show individual retry states. A verified surviving same-thread reply can supply context from retained provenance or one bounded recent window. File grants retain their actual message/thread/part identity; no filename-based provenance substitution occurs. Unit and browser tests cover a missing origin with a surviving reply and successful exact-source import. |
| Linking an ignored email left contradictory state | Link and Ignore share a per-mailbox/message transaction lock. Link creation and dismissal removal commit atomically; same-link and intake retries clear stale dismissals. Tests cover cleanup rollback, retry idempotency and eight rounds of real PostgreSQL Ignore/Link concurrency. |

The final P2 phase completed these checks against the final application source:

| Check | Result |
| --- | --- |
| Six focused Support Email/Gmail/Inbox unit files | 50 passed, zero failures; seven added unit regressions |
| Support Email, identity and recovery Playwright suites | 14 passed, zero failures; three added browser/PostgreSQL regressions |
| Lint | PASS |
| Typecheck | PASS |
| Production build | PASS on Next.js 16.3.6, including Inbox and attachment-review routes |
| `git diff --check` | PASS for tracked changes |

These focused P2 results are distinct from the earlier full-suite runs recorded above. The final browser run completed after correcting synthetic-fixture cleanup to retain append-only history and after Prisma generation finished; it used mock Gmail and the disposable E2E database. Gmail remains strictly `gmail.readonly`. Permissions, source signatures, duplicate protections and private Spaces storage are preserved. No mailbox contents, production data, commit or deployment were changed by P2 validation.

The attachment ordering, bounds and recovery limits are specified in [Support Email architecture](support-email.md). The latest 50 import events remain the recovery-history window; failed-message sources page in batches of 50. Missing originals remain unavailable until restored at their original source, while other available messages remain reviewable.

The final pre-commit cleanup makes the Account/Contact integration assertions explicitly exercise `SUPPORT_GMAIL_ENABLED` in both enabled and disabled states, including email query visibility, Case scope and bounds. It refreshes this evidence summary and the 71-file inventory without changing runtime source. Cleanup validation passed **58 affected unit tests** (8 Support integration tests, including both feature-flag states, plus the 50 focused Support Email/Gmail/Inbox tests), lint and typecheck. Tracked-diff and cleanup-patch whitespace checks passed. Only Git checks complete the cleanup verification; no Playwright suite or production build was rerun, and earlier browser/build evidence is not presented as a new cleanup run.

The already-applied Support migration retains its exact SHA-256 `b0e359d3355ab32d779ca7751b44243c7d68a88aa05c51c046c3bca05712fb24`. A separate untracked-file whitespace review reports its preexisting blank EOF line; it is preserved to avoid changing an applied checksum. No historical migration was edited. Actual secrets, token files, local recovery details and generated reports remain excluded from the commit. Nothing has been staged, committed or deployed.
