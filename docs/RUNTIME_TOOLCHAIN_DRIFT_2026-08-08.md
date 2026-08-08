# Runtime and toolchain drift report

Evidence date: 2026-08-08 (America/New_York).

This is a repository and historical-release evidence comparison. It does not
assert the current Railway runtime or change any provider setting.

## Inventory

| Surface | Declared or recorded value | Assessment |
|---|---|---|
| Root `.nvmrc` | Node `22.23.1` | Repository development and CI baseline. |
| Root `package.json` | Node `22.23.1`; npm `11.17.0`; `packageManager` `npm@11.17.0` | Exact repository pin. |
| `epdg-backend-core/package.json` | Node `22.23.1`; npm `11.17.0`; `packageManager` `npm@11.17.0` | Exact service pin. |
| Core TypeScript types | `@types/node` `20.19.39` | Type definitions are two Node major versions behind the declared runtime. |
| `epdg-backend-core/railway.toml` | Nixpacks; `npm run build`; `npm start`; `/health`; restart on failure | No explicit Node or npm version appears in this file. |
| July 26 Railway release record | Nixpacks with Node `v22.14.0` | Recorded provider Node was older than the repository's exact `22.23.1` declaration. The provider npm version was not recorded. |
| Backend CI | Node `22.23.1`; npm `11.17.0` | The workflow makes repository validation reproducible without changing Railway. |

The runtime difference did not invalidate the successful July 26 release
record, but it means that record was not produced with the exact repository
toolchain. The August 8 `503` readiness observation does not establish whether
runtime drift contributed to the current state.

## Lint debt inventory

The July 26 exact-head release record reports ESLint exit `0`, zero errors, and
`161` warnings. An exact August 8 lint run produced the same totals. The
warnings remain visible rather than suppressed:

| Diagnostic | Warning count | Existing rule |
|---|---:|---|
| Explicit `any` | 142 | `@typescript-eslint/no-explicit-any` from the recommended preset |
| `console.*` | 17 | Repository `no-console: warn` rule |
| Non-null assertions | 2 | `@typescript-eslint/no-non-null-assertion` from the recommended preset |

The CI lint step preserves warnings in job output and fails on errors. Reducing
this debt should be a focused code-quality change, not mixed into release
reconciliation.

The locked core install also reports deprecation notices from the existing
dependency graph, including ESLint 8 and legacy glob/rimraf support packages.
No package or lockfile was changed here; dependency modernization requires a
separate upgrade and regression-test pull request.

## Decisions and boundaries

1. Keep Node `22.23.1` and npm `11.17.0` as the repository and CI baseline in
   this pull request.
2. Do not alter `@types/node`, application dependencies, either lockfile, the
   Nixpacks builder, or any Railway dashboard field in this pull request.
3. Confirm the current Railway build/runtime versions and service root through
   authenticated, names-only dashboard evidence before choosing a provider pin.
4. If Railway can honor the declared versions, test that alignment in an
   approved non-production deployment before Production. If it cannot, propose
   one repository-wide version change in a separate pull request and update all
   declarations together.
5. Evaluate a focused `@types/node` 22 update separately against build, lint,
   route/security tests, and runtime behavior; do not infer compatibility from
   the major number alone.

The pending provider decision and required evidence are captured in
[RAILWAY_RUNTIME_PINNING_DECISION.md](RAILWAY_RUNTIME_PINNING_DECISION.md).

## Verification commands

```text
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm --prefix epdg-backend-core ci --ignore-scripts --no-audit --no-fund
npm --prefix epdg-backend-core run build
npm --prefix epdg-backend-core run lint
npm --prefix epdg-backend-core test
```

These commands are local/CI checks. They do not contact Railway or a database
unless an operator separately supplies service configuration to application
startup; none of these commands starts the service.
