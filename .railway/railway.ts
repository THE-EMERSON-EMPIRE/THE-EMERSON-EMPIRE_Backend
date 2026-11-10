import {
  defineRailway,
  github,
  preserve,
  project,
  service,
} from "railway/iac";

/**
 * Prepared configuration for the isolated EPDG administrator review API.
 * This file is declarative only; do not apply it until the Railway workspace
 * plan and incremental cost are verified and approved.
 */
export default defineRailway(() => {
  const api = service("epdg-admin-staging", {
    source: github("THE-EMERSON-EMPIRE/THE-EMERSON-EMPIRE_Backend", {
      branch: "codex/epdg-admin-api-staging-20261109",
      rootDirectory: "epdg-backend-core",
    }),
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
      NEON_ADMIN_STAGING_PROJECT_ID: "lively-hill-76068632",
      NEON_ADMIN_STAGING_BRANCH_ID: "br-plain-unit-bc3s0lqy",
      DB_HOST: "ep-late-breeze-bce2mem6.c-16.us-east-1.aws.neon.tech",
      DB_PORT: "5432",
      DB_NAME: "emerson_epdg_portal_app",
      DB_USER: "epdg_portal_runtime",
      DB_SSL: "true",
      DB_CONNECTION_TIMEOUT_MS: "5000",
      DB_STATEMENT_TIMEOUT_MS: "15000",

      // Set these via Railway's protected variable interface before deploy.
      DB_PASSWORD: preserve(),
      SESSION_CSRF_SECRET: preserve(),
      PORTAL_ORIGIN: preserve(),
      CORS_ORIGINS: preserve(),
    },
  });

  return project("epdg-admin-staging", { resources: [api] });
});
