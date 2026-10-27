import express, { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createPortalRouter } from '../security/routes';
import { createHandoffRouter } from '../handoff/routes';
import { HandoffService } from '../handoff/HandoffService';
import { handoffEnabled, handoffPath } from '../handoff/config';
import { PortalError } from '../security/primitives';
import { errorHandler } from '../middlewares/errorHandler';
import { validateHostedPracticeEnvironment } from './profile';
import { checkHostedDatabase } from './readiness';
import { getPool } from '../db';

export async function checkHostedReadiness(): Promise<void> {
  validateHostedPracticeEnvironment();
  handoffEnabled();
  const client = await getPool().connect();
  try { await checkHostedDatabase(client); } finally { client.release(); }
}

/** Explicit hosted synthetic entry. No legacy business, admin or provider routes. */
export function createHostedPracticeApp(options: { readinessCheck?: () => Promise<void>; handoffService?: HandoffService } = {}): Express {
  const profile = validateHostedPracticeEnvironment();
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-EPDG-Environment': 'synthetic-hosted' });
    next();
  });
  // Browser API metadata must never change the strict, signed-service receipt.
  const portalEnvelope = (_req: Request, res: Response, next: NextFunction) => {
    const json = res.json.bind(res);
    res.json = (value: unknown) => json(value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value, environment: 'synthetic-hosted', privileged_controls_available: false } : value);
    next();
  };
  app.use('/api', portalEnvelope);
  // A fixed server bucket cannot be evaded using client-controlled proxy headers.
  const healthLimit = rateLimit({ windowMs: 60000, limit: 120, keyGenerator: () => 'hosted-practice-health',
    standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests; try again later', errors: [] } });
  app.get('/health', portalEnvelope, healthLimit, (_req, res, next) => {
    void (options.readinessCheck ?? checkHostedReadiness)().then(() => {
      res.json({ success: true, service: 'epdg-hosted-practice', status: 'ready' });
    }).catch(next);
  });
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.get('Host') !== new URL(profile.backendOrigin).host || req.get('X-Forwarded-Proto') !== 'https') {
      next(new PortalError(403, 'Request verification failed')); return;
    }
    next();
  });
  // Raw signed bytes must be consumed before any JSON parser.
  app.use(handoffPath, createHandoffRouter(options.handoffService));
  app.use('/api', (_req: Request, _res: Response, next: NextFunction) => {
    // Fail closed on current fixture/role/catalog drift before login, sessions,
    // recovery or learning work. Do not retain a successful readiness promise.
    void (options.readinessCheck ?? checkHostedReadiness)().then(() => next(),
      () => next(new PortalError(503, 'Hosted practice is unavailable')));
  }, express.json({ limit: 16384, strict: true }), createPortalRouter());
  app.use((_req, _res, next) => next(new PortalError(404, 'Route not found')));
  app.use(errorHandler);
  return app;
}
