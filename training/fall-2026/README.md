# Fall 2026 Global Internship — Backend Training Sandbox

This directory and the `training/fall-2026-sandbox` branch are Team Eclipse learning infrastructure. They are not a production environment and are not authorization to deploy to Railway, write to Supabase production, or modify live company/client data.

## Purpose
Interns use this branch to practice API orientation, validation, tests, data modeling, authorization concepts, error handling, documentation, and secure development with synthetic data.

## Non-negotiable boundaries
- No passwords, tokens, API keys, private keys, service-role keys, real `.env` values, or production database connection strings.
- No real applicant, intern, client, financial, tax, insurance, medical, HR, or support records.
- No production Supabase/Railway writes from exercises.
- No external outreach, email delivery, CRM updates, or other live side effects from training code.
- Exercise pull requests target `training/fall-2026-sandbox`, never `main` unless separately authorized through the release process.

## Recommended workflow
1. Read the WebDev Platform Orientation Pack and current architecture brief.
2. Branch from `training/fall-2026-sandbox` using `intern/<github-username>/<exercise>`.
3. Use local/mock/test configuration only.
4. Add tests for behavior being changed.
5. Open a PR back to the training branch with test evidence and security notes.
6. Record contribution, collaborators, and AI/tool disclosure in the weekly portfolio.

## Weeks 1–4 exercises
- API/repository orientation and endpoint inventory.
- Request validation and structured error-response exercise.
- Synthetic resource-record schema and CRUD simulation.
- Authorization/RBAC reasoning exercise using tests only.
- Health/readiness endpoint test review without production deployment.
- API documentation and handoff exercise.

## Weeks 5–8 transition
Controlled application labs may begin only after access approval. Production credentials and live systems remain restricted by the Access Register and founder/system-owner approval.

**Training branch owner:** Team Eclipse technical leadership. **Final production authority:** Founder/authorized system owner.