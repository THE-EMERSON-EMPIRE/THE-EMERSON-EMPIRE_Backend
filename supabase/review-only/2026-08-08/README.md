# Supabase access-control review package

> **DRAFT / REVIEW ONLY — DO NOT APPLY**

Nothing in this directory is an executable repository migration. The directory is deliberately outside both automatic migration locations:

- `supabase/migrations/`
- `epdg-backend-core/src/db/migrations/`

No SQL in this package has been run against a local, branch, staging, or production database. The repository does not establish a safe mapping between its custom integer user IDs and a Supabase Auth identity, and it does not record the runtime database role's ownership or `BYPASSRLS` behavior. Those are hard preconditions, not implementation details.

Files:

- `draft_data_api_lockdown.sql` — fail-closed RLS/grant proposal. It enables RLS on known application tables that exist and removes Data API access from `anon` and `authenticated`. It intentionally creates **zero policies**.
- `draft_foreign_key_indexes.sql` — 24 idempotent, forward-only candidate indexes derived from the 2026-07-02 schema reference. Each uses `CONCURRENTLY` and therefore must not run inside a transaction.
- `proven-ownership-relationships.json` — machine-readable relationships proven by the tracked schema. These are candidates for later policy design, not proof that request identity is available to Postgres.

Before any approved use, complete every gate in `docs/supabase-verification-and-compensating-plan.md`, reconcile schema drift, review authenticated catalog exports, run Supabase Security and Performance Advisors, and execute privacy-safe synthetic tests in a disposable non-production project.
