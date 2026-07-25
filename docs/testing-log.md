# Testing Log

Use this file to record backend and deployment tests.

## Test Template

```text
Date:
Tester:
Environment: local / Railway / Netlify integration
Endpoint or feature tested:
Request body used, if applicable:
Expected result:
Actual result:
Status: pass / fail / blocked
Screenshot or proof link:
Reviewer:
Next step:
```

## Required MVP Tests

### Health

- [ ] Root foundation `GET /health` works locally when `DATABASE_URL` is configured.
- [ ] EPDG `GET /health` works locally with the separate `DB_*` variables.
- [ ] EPDG `npm run smoke:health` passes against the exact Railway deployment.
- [ ] The Railway response is from the expected commit and readiness returns `ok`.

### Agency

- [ ] Missing required fields return `400`.
- [ ] Invalid email returns `400`.
- [ ] Missing acknowledgement returns `400`.
- [ ] Valid booking inquiry returns `201`.
- [ ] No sensitive documents are accepted or stored.

### EPDG

- [x] Missing submission fields fail closed with `503`.
- [x] Invalid `fileUrl` fails closed with `503`.
- [x] A syntactically valid deliverable submission also returns `503`; private
  submission writes remain unavailable until ownership, storage, and delivery
  contracts are approved.

### Public Contributions

- [ ] Public contributions route returns only public records.
- [ ] Private or non-public records are not returned.

### Certificates

- [ ] Existing active certificate returns `200`.
- [ ] Missing certificate returns `404`.
- [ ] Revoked/inactive certificate is not exposed as valid.

## Current Blockers

- Exact-head Railway startup fails with PostgreSQL authentication code `28P01`.
- The mapped Railway host is not currently healthy.
- Supabase RLS policy review is still required.
- Live migration-ledger parity is proven for bootstrap ID `0` and repository
  IDs `1`-`33`: all names and deployment-normalized hashes match. Broader live
  schema/role parity remains blocked from release approval.
- Agency tables may need to be created or aligned before Agency routes can be used in production.
