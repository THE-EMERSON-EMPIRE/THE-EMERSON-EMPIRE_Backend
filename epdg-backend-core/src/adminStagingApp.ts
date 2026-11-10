import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { corsOptions } from './utils/corsconfig';
import { logger } from './utils/logger';
import { errorHandler } from './middlewares/errorHandler';
import { sanitizeServerErrors } from './middlewares/sanitizeServerErrors';
import { createAdminStagingRouter } from './security/adminStagingRoutes';
import { isNeonAdminStaging } from './neon-admin-staging/profile';

export interface AdminStagingAppDependencies { readinessCheck: () => Promise<void> }

/** A deliberately narrow app: no legacy APIs, learner routes, CRM handoff, recovery, or public registration. */
export function createAdminStagingApp({ readinessCheck }: AdminStagingAppDependencies): Express {
  if (!isNeonAdminStaging()) throw new Error('Isolated Neon administrator staging profile is required');
  const app = express();
  app.set('trust proxy', false);
  app.use(helmet());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.vary('Origin');
    res.vary('Cookie');
    next();
  });
  app.use(sanitizeServerErrors);
  app.use(express.json({ limit: '16kb' }));
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.get('/health', async (_req, res) => {
    try {
      await readinessCheck();
      res.status(200).json({ success: true, service: 'epdg-admin-staging', status: 'ok' });
    } catch {
      logger.warn('Readiness check failed', { component: 'database' });
      res.status(503).json({ success: false, service: 'epdg-admin-staging', status: 'unavailable' });
    }
  });
  app.use('/api', createAdminStagingRouter());
  app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found', errors: [] }));
  app.use(errorHandler);
  return app;
}
