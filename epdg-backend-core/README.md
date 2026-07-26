# EPDG backend core

Express and TypeScript API for the EPDG platform.

## Local workflow

Use Node.js `22.23.1` and npm `11.17.0`.

```text
npm ci
npm run build
npm run lint
npm test
```

The July 11-12 recorded release-worktree results were: build passed,
route/security tests passed `38/38`, and lint exited `0` with `0` errors and
`161` unsuppressed warnings. Treat these as historical evidence and re-run the
current source before release.

Current July 25 working-tree verification, based on `f6f8670` plus the
uncommitted release-safety changes: build passed, tests passed `47/47`, and lint
exited `0` with `0` errors and the same `161` existing warnings. Repeat these
checks after commit and against the exact deployment.

Populate a local `.env` from the variable names in `.env.example`. Never commit the populated file.

The server validates core configuration, connects to the database, and only
then listens. The application contains no database-migration execution path.
Historical migrations `001`-`033` are source-only audit evidence, use enforced
LF line endings, and are excluded from the compiled runtime artifact.
Destructive files `011` and `024` therefore cannot be executed by this service.
Any future database change requires a separately reviewed, forward-only
operator workflow and compensating plan.

Run a readiness smoke only against an explicit credential-free origin:

```powershell
$env:EPDG_API_ORIGIN='https://reviewed-api-origin.example'
npm run smoke:health
```

```sh
EPDG_API_ORIGIN=https://reviewed-api-origin.example npm run smoke:health
```

The current Railway mapping and database-authentication blocker are documented
in `../docs/RAILWAY_DEPLOYMENT_MANIFEST.md`.

Production browser origins come only from `CORS_ORIGINS`; hardcoded production domains are intentionally absent. Development mode permits the documented local Vite origins.

Current fail-closed boundaries:

- There is no mounted `POST /api/signup`; supported public registration is `POST /api/auth/register`.
- `POST /api/auth/refresh`, anonymous CV upload, agreement acceptance, legacy onboarding completion, private submission writes, intern session rating, and certificate issuance return `503`.
- `/api/portfolio/*`, company dashboard APIs, and school dashboard APIs are not mounted.
- Opportunity routes exist for approved admins and interns, but the active frontend has no opportunity API consumer.

Do not enable the blocked routes by configuration alone. The final role matrix, session lifecycle, private storage ownership/delivery, certificate issuance, and tracked-versus-live schema contracts require review first.

The exact API inventory and known missing frontend contracts are documented in `../docs/BACKEND_ROUTE_AUDIT.md`.
