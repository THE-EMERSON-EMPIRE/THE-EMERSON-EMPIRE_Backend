# Railway runtime pinning decision

Status: **dashboard evidence required; no provider change authorized**

Opened: 2026-08-08 (America/New_York)

## Decision to make

Should Railway be configured to build and run `epdg-backend-core` with the
repository baseline of Node `22.23.1` and npm `11.17.0`, or should all repository
declarations move together to a provider-supported version in a separate pull
request?

## Known evidence

- The repository pins Node `22.23.1` and npm `11.17.0` in `.nvmrc` and both
  package manifests.
- The July 26 release record captured Nixpacks Node `v22.14.0`; it did not
  record the provider npm version.
- `epdg-backend-core/railway.toml` defines build, start, readiness, and restart
  behavior but does not contain a runtime-version setting.
- The July 26 record identified `epdg-backend-core` as the service root and
  recorded a successful Production deployment.
- At approximately 12:07 EDT on August 8 (response `Date` header
  `2026-08-08 16:07:49 UTC`), the canonical `/health` endpoint returned the
  privacy-safe `503` unavailable contract on three read-only checks. This is an
  operational symptom, not evidence of a runtime-version cause.

## Authenticated evidence required

Record names and status only; never copy environment values or private log
content.

- active Railway environment, deployment ID, source branch, and source SHA;
- configured repository and service root;
- builder and effective Node/npm versions from the current build log;
- current deployment state, region, restart/crash history, and recent health
  results;
- privacy-safe database/TLS startup stage and error class, if any;
- whether a supported repository-level declaration can pin Node and npm under
  the current Nixpacks configuration; and
- whether changing that pin creates a new deployment automatically.

## Decision rule

Prefer one reproducible version across local development, CI, and Railway, but
do not change a version until the provider-supported mechanism is proven in a
non-production environment. If a dashboard setting or deploy-triggering change
is required, obtain explicit authorization and record a rollback deployment
before acting.

## Draft issue

**Title:** Decide and verify Railway Node/npm pin for `epdg-backend-core`

**Body:**

> Repository and CI declarations use Node `22.23.1` and npm `11.17.0`, while
> the July 26 Railway release record captured Nixpacks Node `v22.14.0` and did
> not record npm. Confirm the current service root, source SHA, builder, and
> effective runtime from authenticated dashboard/build-log evidence without
> copying environment values. Then choose either a tested provider pin matching
> the repository or a separate repository-wide version change. Do not alter
> Production settings or trigger a deployment until the mechanism, verification
> plan, and rollback target are reviewed.
