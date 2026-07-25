# The Emerson Empire backend repository

This repository currently contains two separate Express entrypoints:

- `server.js`: a small JavaScript API foundation for Agency inquiries, public contributions, and certificate-number verification.
- `epdg-backend-core`: the TypeScript API that implements the EPDG authentication, intern, mentor, and administrator route surface.

Provider evidence maps Railway to the `epdg-backend-core` entrypoint, but the exact-head deployment is currently failed and its public host is not healthy. [docs/RAILWAY_DEPLOYMENT_MANIFEST.md](docs/RAILWAY_DEPLOYMENT_MANIFEST.md) is the single target, origin-classification, and database-diagnosis record. Do not deploy the root foundation in its place.

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

Recorded July 11-12 local verification for the earlier preserved release worktree:

- Root security tests: `9` passed, `0` failed.
- EPDG build: passed with no TypeScript errors.
- EPDG route/security tests: `38` passed, `0` failed.
- EPDG lint: exited `0` with `0` errors and `161` warnings. The warnings remain visible code-quality debt and were not suppressed.
- `git diff --check`: passed; Git reported line-ending conversion notices only.

These are historical local results, not proof for later source changes or a
Railway deployment. Re-run every command at the exact commit being reviewed and
record the new results in `docs/OVERNIGHT_FULL_STACK_RELEASE.md`.

Current July 25 working-tree verification, based on `f6f8670` plus the
uncommitted release-safety changes:

- Root security tests: `9/9` passed.
- EPDG build: passed.
- EPDG route/release-safety tests: `48/48` passed.
- EPDG lint: exit `0`, `0` errors, `161` existing warnings.
- Missing-origin readiness-smoke validation: rejected with the expected
  privacy-safe exit.

This working-tree result must be repeated after commit and on the exact Railway
deployment; it is not platform evidence.

The EPDG server validates required environment configuration and database connectivity before listening. It does not apply migrations at startup. The root foundation requires an explicit production database connection and CORS allowlist; feature switches are fail-closed.

The current EPDG compatibility boundary is deliberately fail-closed: generic `/api/signup` and `/api/portfolio/*` routes are not mounted, while token refresh, anonymous CV upload, agreement acceptance, legacy onboarding completion, private submission writes, session rating, and certificate issuance remain unavailable until their ownership, revocation, storage, or legal contracts are approved. Company and school dashboard data APIs are not implemented. Backend opportunity routes exist, but the active frontend does not consume them.

No successful current-head Railway deployment, database migration, or external storage change is represented by the local verification above. A names-only `CORS_ORIGINS` update was recorded in Railway on July 12; current target and failure evidence are in the deployment manifest.

Environment variable names and purposes are documented in the two `.env.example` files. Never commit populated environment files.

See [docs/BACKEND_ROUTE_AUDIT.md](docs/BACKEND_ROUTE_AUDIT.md) for the exact route inventory, frontend coverage, and blocked schema/release decisions.
