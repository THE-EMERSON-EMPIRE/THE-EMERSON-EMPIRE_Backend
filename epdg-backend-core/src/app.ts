import express, { Express } from 'express';
import cors from 'cors';
import { createPortalRouter } from './security/routes';
import helmet from 'helmet';
import { testConnection } from './db';
import { logger } from './utils/logger';
import { corsOptions } from './utils/corsconfig';
import { errorHandler } from './middlewares/errorHandler';
import { sanitizeServerErrors } from './middlewares/sanitizeServerErrors';
import { createHandoffRouter } from './handoff/routes';
import { handoffPath } from './handoff/config';

export interface AppDependencies {
  readinessCheck?: () => Promise<void>;
}

export function createApp({ readinessCheck = testConnection }: AppDependencies = {}): Express {
  const app = express();

  app.set('trust proxy', false);
  app.use(helmet());
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache'); res.setHeader('Referrer-Policy', 'no-referrer'); res.vary('Origin'); res.vary('Cookie'); next(); });
  app.use(sanitizeServerErrors);
  // Authenticate bounded exact bytes before JSON parsing and browser CORS.
  app.use(handoffPath, createHandoffRouter());
  app.use(express.json({ limit: '16kb' }));

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  app.get('/health', async (_req, res) => {
    try {
      await readinessCheck();
      res.status(200).json({
        success: true,
        service: 'epdg-backend-core',
        status: 'ok',
      });
    } catch {
      logger.warn('Readiness check failed', { component: 'database' });
      res.status(503).json({
        success: false,
        service: 'epdg-backend-core',
        status: 'unavailable',
      });
    }
  });

  app.use('/api', createPortalRouter());

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
      errors: [],
    });
  });

  app.use(errorHandler);
  return app;
}
