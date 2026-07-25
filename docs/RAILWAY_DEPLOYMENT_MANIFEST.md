# Railway deployment manifest

Evidence status: 2026-07-25 (America/New_York).

This is the single repository record for the Railway target. Provider mapping
evidence identifies the service, but the mapped service is **not a verified
healthy release**. Backend PR #2 must remain draft until the release gates
below pass at the exact deployed commit.

## Authoritative target

| Field | Current evidence |
|---|---|
| Railway project | `epdg platform` (`34659053-7658-4d6e-8d0e-469f91ec6058`) |
| Railway service | `tranquil-tenderness` (`fccb017f-ec3a-472e-ab19-f72011bf84f7`) |
| Connected repository | `webdev692/THE-EMERSON-EMPIRE_Backend` |
| Release-candidate branch | `codex/full-stack-release-2026-07-11` |
| Audited PR/head | PR #2 at `f6f867000a2dafbaadd0cfc35e36ccb3250da94c` |
| Service root | `/epdg-backend-core` |
| Install | Railway/Nixpacks-managed deterministic install |
| Build | `npm run build` |
| Start | `npm start` |
| Readiness | `GET /health` |
| Mapped production environment | `production_epdg` |
| Mapped public host | `https://tranquil-tenderness-productionepdg.up.railway.app` |
| Database connection method | Separate server-only PostgreSQL variables; not `DATABASE_URL` |

The mapped host is the only candidate production API origin. It must not be
published as a working frontend origin until an exact-head deployment returns
the expected readiness contract and passes CORS and protected-route probes.
The root JavaScript foundation is not the mapped Railway entrypoint.

The production branch/promotion policy still requires provider confirmation.
The branch above identifies the current PR #2 release candidate, not permission
to change Railway's production source policy.

## Current failure

The exact-head Railway status context `epdg platform - tranquil-tenderness` is
`failure`. The build succeeds, but startup stops at the database stage before
binding. Provider evidence reported PostgreSQL code `28P01`, which means the
server rejected the supplied authentication tuple. No credential value was
read, recorded, or changed.

The EPDG service reads these database variable names:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL`
- `DB_CONNECTION_TIMEOUT_MS`
- `DB_STATEMENT_TIMEOUT_MS`

`DATABASE_URL` belongs to the separate root foundation and is not consumed by
the mapped EPDG service. Because EPDG passes `DB_PASSWORD` separately to the
PostgreSQL client, URL-encoding reserved password characters is not part of
this connection path.

Safe provider verification must compare variable **presence and pairing**, not
values:

1. Confirm the host, port, database, and user are one current Supabase direct
   or pooler tuple; do not mix fields from the two connection modes.
2. Confirm `DB_PASSWORD` is the current password for that tuple.
3. Confirm `DB_SSL` is not `false` in production.
4. Compare the names and presence status independently in `production_epdg`
   and the PR #2 environment; do not assume Railway copies later changes.
5. Redeploy the exact reviewed head, then run the following without printing
   environment values:

   PowerShell: `$env:EPDG_API_ORIGIN='<origin>'; npm run smoke:health`

   POSIX: `EPDG_API_ORIGIN=<origin> npm run smoke:health`

## Historical origin classification

These classifications are based on repository history, provider evidence, and
read-only probes on 2026-07-25.

| Origin | Classification | Evidence |
|---|---|---|
| `tranquil-tenderness-productionepdg.up.railway.app` | Current provider mapping, unhealthy/unverified | Timed out during current probes; the exact-head deployment status is failed. |
| `tranquil-tenderness-the-emerson-empirebackend-pr-2.up.railway.app` | Preview-only, currently invalid | Railway edge returned `404 Application not found`. |
| `tranquil-tenderness-production-6010.up.railway.app` | Historical, currently unavailable | Timed out during current probes and is not the mapped `production_epdg` host. |
| `the-emerson-empirebackend-production.up.railway.app` | Stale/invalid | Railway edge returned `404 Application not found`. |
| `backend-production-4b0a9.up.railway.app` | Stale/invalid | Railway edge returned `404 Application not found`. |
| `backend-productionepdg.up.railway.app` | Stale/invalid | Railway edge returned `404 Application not found`. |

Do not restore any historical host as a source-code fallback. Provider
environment settings must be checked separately and changed only after the
mapped host is healthy at the reviewed commit.

## Mandatory release gates

- Exact-head Railway deployment succeeds and `npm run smoke:health` passes.
- Database authentication succeeds without logging connection details.
- Required environment-variable presence is verified separately for production
  and PR contexts.
- Production and approved preview origins pass exact CORS preflights; an
  untrusted origin remains denied.
- Unauthenticated protected routes return `401` or `403`, not `404`.
- The reviewed migration baseline and live migration history reconcile. This
  gate passed in a metadata-only comparison on 2026-07-25: live
  `public.migrations` contains bootstrap ID `0` plus IDs `1`-`33`, and all 33
  names and `postgres-migrations` SHA-1 values match the repository files when
  evaluated with deployment (LF) line endings. Historical migrations `011`
  and `024` are recorded as applied and are not pending.
- Historical SQL is source-only audit evidence; the application build excludes
  it from `dist` and contains no migration execution path.
- A forward-only schema reconciliation and reviewed RLS/grant model are
  approved separately.
- Current root tests, EPDG build, EPDG tests, lint, diff check, and credential
  scan pass at the commit being deployed.

## Rollback

For code-only rollback, select the last verified deployment of this same
service and commit in Railway, then repeat readiness, CORS, and protected-route
checks. Database rollback is a separately reviewed forward compensating
migration. Never reset migration history, run historical table drops, or
replace production records.
