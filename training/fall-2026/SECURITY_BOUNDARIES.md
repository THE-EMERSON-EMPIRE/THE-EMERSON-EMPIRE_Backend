# Backend Security and Data Boundaries

- Use synthetic, anonymized, or approved public-source data only.
- Never commit real secrets, production environment files, service-role keys, database passwords, OAuth credentials, email-provider tokens, or private user records.
- Training code must not call production write endpoints or send live email/messages.
- Do not run migrations against production from this branch.
- Do not resume, pause, reset, seed, truncate, or otherwise modify production Supabase/Railway resources as part of an internship exercise.
- Follow least privilege. Access to any live provider is granted separately through the Enterprise Access Register and may be read-only or staging-only.
- Exercise PRs target `training/fall-2026-sandbox`.
- Material AI assistance must be reviewed and disclosed. Never place credentials/private records into unapproved AI tools.
- If a credential or private record is exposed, stop propagation and follow the restricted incident procedure immediately.
