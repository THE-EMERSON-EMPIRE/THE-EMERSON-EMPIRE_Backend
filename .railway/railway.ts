import {
  defineRailway,
  empty,
  github,
  preserve,
  project,
  service,
} from "railway/iac";

const runtimeEnv = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const attachGitHubSource = runtimeEnv.EPDG_RAILWAY_ATTACH_SOURCE === "1";

/**
 * Preparation is two phase: the default config creates an empty service so
 * protected runtime variables can be entered before attaching the app source.
 * Set EPDG_RAILWAY_ATTACH_SOURCE=1 only after billing, SSO, origins, and
 * protected environment variables are confirmed. Never apply without approval.
 */
export default defineRailway(() => {
  const api = service("epdg-admin-staging", {
    source: attachGitHubSource
      ? github("THE-EMERSON-EMPIRE/THE-EMERSON-EMPIRE_Backend", {
          branch: "codex/epdg-admin-api-staging-reconciled-20261111",
          rootDirectory: "epdg-backend-core",
        })
      : empty(),
    build: "npm run build",
    start: "npm run start:admin-staging",
    healthcheck: "/health",
    healthcheckTimeout: 60,
    replicas: 1,
    env: {
      NODE_ENV: "production",
      EPDG_NEON_ADMIN_STAGING_MODE: "1",
      EPDG_SYNTHETIC_MODE: "1",
      EPDG_ADMIN_STAGING_MODE: "1",
      NEON_ADMIN_STAGING_PROJECT_ID: preserve(),
      NEON_ADMIN_STAGING_BRANCH_ID: preserve(),
      DB_HOST: preserve(),
      DB_PORT: "5432",
      DB_NAME: preserve(),
      DB_USER: preserve(),
      DB_SSL: "true",
      DB_CONNECTION_TIMEOUT_MS: "5000",
      DB_STATEMENT_TIMEOUT_MS: "15000",
      DB_PASSWORD: preserve(),
      SESSION_CSRF_SECRET: preserve(),
      PORTAL_ORIGIN: preserve(),
      CORS_ORIGINS: preserve(),
    },
  });
  return project("epdg-admin-staging", { resources: [api] });
});
