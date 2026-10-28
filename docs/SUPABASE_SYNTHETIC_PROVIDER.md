# Separate Supabase synthetic database candidate

This candidate preserves the working Railway database profile and migrations.
The API remains on Railway. The new source-pinned database profile is disabled;
the absent provider selector continues using Railway. Selecting `supabase`
without separately reviewed source enablement fails closed.

The reviewed target is the new `epdg-portal-synthetic` Supabase project
`ymitqvcxttcbesijzbfy` in organization `hickjdguujhpyiqjddip`, with database
`postgres` and direct endpoint `db.ymitqvcxttcbesijzbfy.supabase.co:5432`.
The disabled source profile selects the dashboard-verified session endpoint
`aws-0-us-west-1.pooler.supabase.com:5432`, using the project-suffixed login while
retaining the base SQL principal. The reviewed direct endpoint remains supported
as a separate source profile configuration; its IPv6 reachability is unproven.
Actual session behavior tests remain required. Both routes require verified
network reachability, the approved CA and normal TLS hostname checks.
Transaction pooling and port 6543 are outside this candidate.

The application keeps its opaque sessions, CSRF safeguards, recovery process,
private database attachment bytes and private recovery-mail capture. It uses no
Supabase Auth, browser database client, API key or service-role key. Owner/admin
controls, registration, invitations and role management stay closed. The
preferred login alias resolves to the fictional learner B; all database email
identities and captured recipients retain `.invalid` addresses.

## Reviewed application schema boundary

The new manifest lists eleven CLI-created SQL files explicitly. These create
only `core`, `epdg`, `portal_security`, `synthetic_learning`, `synthetic_handoff`,
`hosted_practice` and `synthetic_meta`: eight required compatibility tables plus
24 protected portal/learning/handoff/hosted tables and one immutable marker.
All 33 tables have RLS, with 52 exact role policies and 22 retained triggers.
Foreign-key/type/sequence dependencies close inside these application schemas.
The first security migration and learning migrations 001–006 retain their exact
upstream bytes. Separate provider ports of 007/008 record their actual applied
hashes and retain upstream hashes as provenance. No original SQL is rewritten.

Do not run a generic `supabase db push` against this repository. Its migration
directory also retains an unrelated historical migration. The explicit
`supabase-schema-manifest.json` is the operator job's only execution allowlist.
New filenames were created using the official pinned Supabase CLI 2.122.0;
the manifest records its release and verified archive checksum.
The CLI only generated filenames. This operator uses its own app migration
ledgers and Git-reviewed source hashes; Supabase `list_migrations` is not its
authoritative ledger. Do not substitute `db push` or MCP `apply_migration` for
the controlled operator: those can create an unrelated managed migration schema
and violate the exact namespace boundary.

The managed `postgres` operator owns the seven new schemas and their objects.
The private `epdg_synthetic_app` login owns nothing, has no memberships and is
`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`.
Only exact column grants, table reads and two invoker scope functions are
available. Managed schema/database/global default ACLs are preserved; explicit
app-object revokes exclude PUBLIC, anon, authenticated, authenticator and
service_role. Future app DDL must repeat the explicit safe grant postcondition;
schema-scoped default revokes cannot negate PostgreSQL global default grants.

Supabase's inherited PUBLIC TEMP permission remains. The candidate pins this
provider difference instead of altering a managed database-wide ACL. App queries
qualify their relations, use `pg_catalog,epdg,pg_temp` with temp explicitly last,
and audit effective managed-object privileges. The runtime rejects role,
ownership, fixture, provider marker, ledger, policy, trigger, app grant or managed
schema ACL drift. Readiness checks both direct and inherited browser/service
role privileges. This does not claim the provider's superuser/service operator
is unable to change its own database.

## Operator and acceptance sequence

`epdg-backend-core/scripts/hosted-practice/bootstrap-supabase.cjs` is an explicit
operator job; startup never imports or invokes it. It requires a private
operator credential, separate generated app credential and separate fictional
fixture password. Credentials go through authorized runtime secret injection;
never put them in source, SQL migration history, command text, public logs or
chat. The generated app password is passed to PostgreSQL as a bound parameter
and formatted inside a transaction-local operator statement. The API receives
only the app credential and never the operator or fixture credentials.

The named root-context `Dockerfile.supabase-operator` builds the pinned toolchain
without browser tooling, installs locked production dependencies in its final
stage, copies the explicit eleven-file SQL allowlist and required operator
assets, and runs as non-root `node`. Its dedicated ignore file excludes private
runtime files and unrelated legacy SQL. Use its default operator command; it
opens no HTTP port and is not an API deployment. No local Docker engine was
available, so the provider image build remains a separate acceptance check.

Before installation, the job requires all seven namespaces and the app role to
be absent. It locks the operation, verifies the managed operator and strict TLS,
checks every source hash, installs the app-only bundle and creates four new
fictional identities plus fixed synthetic learning fixtures. It copies no rows
from either the Railway database or HR/CRM. A repeat run verifies the exact
binding and ledger and preserves rows, passwords and retained evidence.
Managed objects/ACLs/global defaults are snapshotted before and after.

Local PostgreSQL 17.11 acceptance passed fresh/repeat preservation, 44 isolation
and drift cases, wrong-CA/hostname rejection, TEMP shadow checks, preconnect
guards and hostile-global-default preservation. Hosted acceptance must also
verify actual login/recovery/learning/mentor/handoff flows and Supavisor session
login mapping, startup options and GUC forwarding. Hosted acceptance
additionally requires verified selected-route reachability and secure runtime
credential provisioning. No second authentication provider is introduced.

After acceptance, source enablement and the runtime provider selector are a
separate reviewed cutover. Start fresh sessions, a separate HMAC secret and CRM
clearance events bound to the new target; do not clone or silently replay old sessions/approvals. The
previous Railway database remains a rollback baseline. Containment disables the
new profile/bridge or returns to the verified earlier provider; never reverse
migration history, overwrite retained evidence or delete managed data.

Primary references: [custom Postgres roles](https://supabase.com/docs/guides/database/postgres/roles),
[connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres),
[strict TLS](https://supabase.com/docs/guides/platform/ssl-enforcement),
[API grants and RLS](https://supabase.com/docs/guides/api/securing-your-api), and
[Postgres 17.11 changes](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
