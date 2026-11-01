'use strict';
const { install } = require('./network-guard.cjs');
install();
const { config, preflight } = require('./common.cjs');
const { validateEnvironment } = require('../../dist/config/env.js');
const { createApp } = require('../../dist/app.js');
const {portalConfig}=require('../../dist/security/config.js');
const {checkSecuritySchema}=require('../../dist/security/PortalService.js');
const {checkLearningReadiness}=require('../../dist/learning/LearningService.js');
(async () => {
  validateEnvironment();
  portalConfig();
  await preflight(config());
  await checkSecuritySchema();
  await checkLearningReadiness();
  // Recheck the pinned database identity on every readiness request.
  const app = createApp({readinessCheck: async () => {await preflight(config());await checkSecuritySchema();await checkLearningReadiness();}});
  app.set('trust proxy', false);
  app.listen(58000, '127.0.0.1', () => console.log('Synthetic backend ready on loopback port 58000'));
})().catch(() => { console.error('Synthetic backend startup gate failed'); process.exit(1); });
