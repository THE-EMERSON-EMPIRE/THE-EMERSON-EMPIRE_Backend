'use strict';
const { install } = require('./network-guard.cjs');
install();
const { config, preflight, runtimeEnv } = require('./common.cjs');
const c = config();
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, runtimeEnv(c), { EPDG_ADMIN_STAGING_MODE: '1' });

const { validateEnvironment } = require('../../dist/config/env.js');
const { portalConfig } = require('../../dist/security/config.js');
const { checkSecuritySchema } = require('../../dist/security/PortalService.js');
const { createAdminStagingApp } = require('../../dist/adminStagingApp.js');

(async () => {
  validateEnvironment();
  portalConfig();
  await preflight(c);
  await checkSecuritySchema();
  const app = createAdminStagingApp({ readinessCheck: async () => {
    await preflight(c);
    await checkSecuritySchema();
  } });
  app.set('trust proxy', false);
  app.listen(58000, '127.0.0.1', () => console.log('Synthetic administrator API ready on loopback port 58000'));
})().catch(() => {
  console.error('Synthetic administrator startup gate failed');
  process.exit(1);
});
