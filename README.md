# The Emerson Empire backend repository

This repository currently contains two separate Express entrypoints:

- `server.js`: a small JavaScript API foundation for Agency inquiries, public contributions, and certificate-number verification.
- `epdg-backend-core`: the TypeScript API that implements the EPDG authentication, intern, mentor, and administrator route surface.

Provider evidence maps Railway to the `epdg-backend-core` entrypoint; the root
foundation must not be deployed in its place. Backend PR #2 merged on July 26,
2026, producing `main` commit
`7bfdb114363147ec2998d151dff22a786b2122ba`. The
[merged frontend PR #27](https://github.com/webdev692/Empire-emerson_frontend/pull/27)
release record then recorded Railway Production deployment
`cbb535d2-bff0-43af-839b-26e53e5a97dc` as successful and active in Europe West
(Amsterdam) at `https://tranquil-tenderness-productionepdg.up.railway.app`.
Those facts are dated July 26 release evidence, not a fresh provider check.

At approximately 12:07 EDT on August 8, 2026 (response `Date` header
`2026-08-08 16:07:49 UTC`), three read-only `/health` checks returned the
privacy-safe EPDG `503 Service unavailable` readiness contract. That observation
does not diagnose the cause. The active deployment, source SHA, service root,
runtime, restart history, logs, and database/TLS startup now require
authenticated Railway dashboard verification.
[docs/RAILWAY_DEPLOYMENT_MANIFEST.md](docs/RAILWAY_DEPLOYMENT_MANIFEST.md) is
the single target, evidence-date, origin-classification, and dashboard-check
record.

## Toolchain

- Node.js `22.23.1`
- npm `11.17.0`

Use deterministic installs:

```text
npm ci
npm --prefix epdg-backend-core ci
```

## Verification

```text
npm test
npm --prefix epdg-backend-core run build
npm --prefix epdg-backend-core run lint
npm --prefix epdg-backend-core test
```

Run the privacy-safe readiness smoke only with a reviewed, explicit target;
there is no default origin:

```powershell
$env:EPDG_API_ORIGIN='https://reviewed-api-origin.example'
npm run smoke:health
```

See
[docs/RUNTIME_TOOLCHAIN_DRIFT_2026-08-08.md](docs/RUNTIME_TOOLCHAIN_DRIFT_2026-08-08.md)
for the runtime, Node type-definition, and lint-debt inventory.

Recorded July 11-12 local verification for the earlier preserved release worktree:

- Root security tests: `9` passed, `0` failed.
- EPDG build: passed with no TypeScript errors.
- EPDG route/security tests: `38` passed, `0` failed.
- EPDG lint: exited `0` with `0` errors and `161` warnings. The warnings remain visible code-quality debt and were not suppressed.
- `git diff --check`: passed; Git reported line-ending conversion notices only.

These are historical local results, not proof for later source changes or a
Railway deployment. Re-run every command at the exact commit being reviewed and
record the new results in `docs/OVERNIGHT_FULL_STACK_RELEASE.md`.

Superseded July 25 working-tree verification, based on `f6f8670` plus the
then-uncommitted release-safety changes:

- Root security tests: `9/9` passed.
- EPDG build: passed.
- EPDG route/release-safety tests: `48/48` passed.
- EPDG lint: exit `0`, `0` errors, `161` existing warnings.
- Missing-origin readiness-smoke validation: rejected with the expected
  privacy-safe exit.

At that time, the working-tree result still required repetition after commit
and on the exact Railway deployment; it was not platform evidence.

July 26 pre-merge PR-environment evidence for runtime code head
`138608083efe273e7bd20ecd101a0efa5b6700f5`:

- Railway PR deployment `16c0c861-1d01-40fa-bed8-0330c1f88460`: successful
  and online under Nixpacks with Node `v22.14.0`.
- Strict CA-verified PostgreSQL TLS and a fresh `SELECT 1`: passed.
- `GET /health`: HTTP `200` with the intended healthy response.
- Configured approved origins: accepted with exact allow-origin headers;
  an untrusted origin: `403` with no allow-origin header.
- Synthetic pending-company sign-in and `GET /api/auth/me`: `200`;
  administrator route with that role: `403`; missing, malformed, expired, and
  post-cleanup tokens: `401`.
- The temporary non-production QA identity was hard-deleted; independent
  cleanup verification found zero related synthetic rows.
- Root tests: `9/9`; EPDG build: passed; EPDG tests: `55/55`; lint: `0`
  errors and `161` existing warnings.
- The built artifact contains no SQL, migration directory, migration executor,
  or `postgres-migrations` runtime dependency. Credential and deployment-log
  scans found no secret values.

The later July 26 Production release record for merged backend `main` commit
`7bfdb114363147ec2998d151dff22a786b2122ba` recorded the Production deployment
and origin above, strict CA-verified PostgreSQL TLS, a fresh `SELECT 1` before
listen, `/health` at `200`, approved and rejected CORS behavior, authentication
boundaries, least-privileged synthetic QA cleanup, migration-execution safety,
and build/deploy/runtime secret scans. No environment values or private rows
are reproduced here.

The EPDG server validates required environment configuration and database connectivity before listening. It does not apply migrations at startup. The root foundation requires an explicit production database connection and CORS allowlist; feature switches are fail-closed.

The current EPDG compatibility boundary is deliberately fail-closed: generic `/api/signup` and `/api/portfolio/*` routes are not mounted, while token refresh, anonymous CV upload, agreement acceptance, legacy onboarding completion, private submission writes, session rating, and certificate issuance remain unavailable until their ownership, revocation, storage, or legal contracts are approved. Company and school dashboard data APIs are not implemented. Backend opportunity routes exist, but the active frontend does not consume them.

The two July 26 records are historical release evidence. Neither proves the
current August 8 operational state, and the `503` observation does not establish
a root cause. No repository command automatically deploys, changes Railway
settings, or runs a migration.

Environment variable names and purposes are documented in the two `.env.example` files. Never commit populated environment files.

See [docs/BACKEND_ROUTE_AUDIT.md](docs/BACKEND_ROUTE_AUDIT.md) for the exact route inventory, frontend coverage, and blocked schema/release decisions.
