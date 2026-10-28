# Private hosted synthetic recovery check

This explicit operator facility tests only `learner-a@epdg.invalid`. It leaves
the preferred learner B login alias untouched. It runs no migration and performs
no database DML. Password changes use the normal HTTPS portal APIs exclusively.
The API must already use the reviewed Supabase database and pass strict readiness.
The source profile remains disabled until separately reviewed enablement.

The existing operator image's default command remains bootstrap. To run this
check deliberately, select its separate command from the image's core directory:

```text
node scripts/hosted-practice/recovery-acceptance.cjs
```

Use the existing operator job and private runtime injection. Required variable
names and purposes are:

| Name | Purpose |
| --- | --- |
| `EPDG_HOSTED_PRACTICE_RECOVERY_ACCEPTANCE` | Explicit recovery-check opt-in |
| `EPDG_HOSTED_PRACTICE_BOOTSTRAP` | Existing private operator gate |
| `EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER` | Existing reviewed provider selector |
| `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID` | Exact operator identity supplied by Railway |
| `EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD` | Privately entered new Supabase operator credential |
| `HOSTED_PRACTICE_APP_PASSWORD` | Separately generated existing app credential, retained for operator separation checks |
| `HOSTED_PRACTICE_FIXTURE_PASSWORD` | Existing fictional fixture credential to restore through the API |
| `HOSTED_PRACTICE_DB_CA_CERT` | Approved database CA for strict TLS and peer-name verification |

Do not put secret values in command text, source, migration history, reports or
chat. The helper rejects wire-debug/TLS-disable settings and inherited provider
credentials forbidden by the existing bootstrap gate. It uses no HMAC/handoff,
SMTP or external mail-service key. It accepts no email or API endpoint override.

Before any recovery reset, the operator verifies selected database identity,
strict TLS and read-only mode. It then signs in the fixed fictional learner and
requires that fresh opaque session's hash in the selected database. An API still
using the old Railway database fails this proof before requesting recovery.
Private capture reads are bounded, marker-based and limited to the fixed learner.

After connecting, the helper explicitly sets and verifies the fixed search path,
read-only mode and statement timeout before reading data. A session pooler may
ignore connection startup options. These fixed session settings perform no
schema or record mutation; every subsequent data query is SELECT-only.

Success requires the generic response, exactly one fresh capture, exact approved
frontend reset link, twenty-minute HTML notice and token lifetime, valid reset,
old-session revocation, reused-token rejection and new-password sign-in. The
fixture is restored using normal change-password; restored sign-in and test
session revocation are verified. Finally cleanup attempts restoration after an
ambiguous reset response as well. Failure or incomplete restoration is never
reported as success. Do not run bootstrap midway through this test; wait for a
successful restoration result before relying on its fixture-password invariant.

Only a boolean/fixed-stage summary is emitted. The helper never emits raw HTML,
reset links, recovery tokens, passwords, cookies, CSRF values or upstream errors.
On failure, preserve the safe summary and keep the release closed; diagnose the
named stage privately. No live hosted recovery acceptance is claimed merely by
building or publishing this facility.
