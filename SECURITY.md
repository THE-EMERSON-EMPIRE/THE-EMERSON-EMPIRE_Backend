# Security policy

## Supported code

Security fixes are prepared against the current `main` branch. Historical
branches, preview deployments, and superseded release candidates are not
separately supported.

## Report a vulnerability privately

Use this repository's GitHub **Report a vulnerability** form when private
vulnerability reporting is available. If it is unavailable, contact the
repository owner through an already established private channel and ask for a
private security-advisory thread. Do not open a public issue containing an
unpatched vulnerability, credential, environment value, private record, or
provider configuration detail.

Include only the minimum privacy-safe evidence needed to reproduce the issue:

- affected commit and route or file;
- impact and required preconditions;
- synthetic reproduction steps;
- whether authentication or a particular role is required; and
- a suggested mitigation, if known.

Do not use real applications, intern records, evaluations, contracts, private
messages, or production credentials as test data. Never copy secrets into the
report. A maintainer will coordinate severity, remediation, disclosure, and
any release timing in the private thread; this project does not promise a
fixed response or disclosure deadline.

## Operational boundaries

Reporting a vulnerability does not authorize production probing, provider
changes, database access, migrations, or data modification. Use local or
explicitly approved non-production environments and synthetic data only.
