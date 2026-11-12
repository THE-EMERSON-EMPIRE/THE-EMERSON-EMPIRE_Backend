import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PoolClient } from 'pg';
import rateLimit from 'express-rate-limit';
import { AdminService } from './AdminService';
import { PortalService } from './PortalService';
import { portalOriginAllowed, portalConfig } from './config';
import { constantEquals, csrfToken, emailAddress, PortalError, sessionCookie } from './primitives';
import { hasAdminPermission, isAdminStagingEnabled, type AdminPermission } from './adminPolicy';

type Handler = (req: Request, res: Response) => Promise<void>;

function body(req: Request, keys: string[]): Record<string, unknown> {
  const value: unknown = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new PortalError(400, 'Invalid request fields');
  }
  return value as Record<string, unknown>;
}

export function createAdminStagingRouter(): Router {
  const router = Router();
  const service = new PortalService();
  const administrator = new AdminService();
  const wrap = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(error => {
      if (error instanceof PortalError && error.statusCode === 401 && req.headers.cookie) {
        const config = portalConfig();
        res.clearCookie(config.cookieName, { ...config.cookie, maxAge: undefined });
      }
      next(error);
    });
  };
  const limits = (max: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max,
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Too many requests; try again later', errors: [] } });

  router.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    try {
      if (!isAdminStagingEnabled()) throw new PortalError(503, 'Unavailable pending security review');
      if (req.headers.authorization) throw new PortalError(401, 'Authentication required');
      if (!portalOriginAllowed(req.get('Origin')) || req.get('Sec-Fetch-Site') === 'cross-site' ||
          req.get('X-EPDG-Request') !== 'portal') throw new PortalError(403, 'Request verification failed');
      if (!req.is('application/json')) throw new PortalError(415, 'JSON content type required');
      next();
    } catch (error) { next(error); }
  });

  router.post('/auth/login', limits(20), wrap(async (req, res) => {
    const input = body(req, ['email', 'password']);
    const email = emailAddress(input.email);
    if (!email || !email.endsWith('@epdg.invalid') || typeof input.password !== 'string' ||
        input.password.length < 1 || Buffer.byteLength(input.password) > 72) {
      throw new PortalError(401, 'Invalid email or password');
    }
    const result = await service.login(email, input.password, sessionCookie(req));
    const config = portalConfig();
    res.cookie(config.cookieName, result.token, config.cookie);
    res.json({ success: true, user: result.user, expires_at: result.expiresAt, csrf_token: csrfToken(result.token) });
  }));

  router.get('/auth/session', wrap(async (req, res) => {
    if (Object.keys(req.query).length) throw new PortalError(400, 'Query parameters are not accepted');
    const raw = sessionCookie(req);
    if (!raw) throw new PortalError(401, 'Authentication required');
    const session = await service.session(raw);
    res.json({ success: true, user: session.user, expires_at: session.expiresAt, csrf_token: csrfToken(raw) });
  }));

  router.post('/auth/logout', wrap(async (req, res) => {
    body(req, []);
    const raw = sessionCookie(req);
    if (!raw) throw new PortalError(401, 'Authentication required');
    if (!constantEquals(req.get('X-CSRF-Token'), csrfToken(raw))) throw new PortalError(403, 'Request verification failed');
    await service.logout(raw);
    const config = portalConfig();
    res.clearCookie(config.cookieName, { ...config.cookie, maxAge: undefined });
    res.json({ success: true });
  }));

  const adminAuthenticated = (permission: AdminPermission,
    handler: (client: PoolClient, user: Awaited<ReturnType<PortalService['session']>>['user'], req: Request) => Promise<unknown> | unknown) =>
    wrap(async (req, res) => {
      if (!isAdminStagingEnabled()) throw new PortalError(503, 'Unavailable pending security review');
      if (Object.keys(req.query).length) throw new PortalError(400, 'Query parameters are not accepted');
      const raw = sessionCookie(req);
      if (!raw) throw new PortalError(401, 'Authentication required');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !constantEquals(req.get('X-CSRF-Token'), csrfToken(raw))) {
        throw new PortalError(403, 'Request verification failed');
      }
      const data = await service.withAuthenticatedSession(raw, async (client, user) => {
        if (!hasAdminPermission(user, permission)) throw new PortalError(403, 'Administrator permission required');
        return handler(client, user, req);
      });
      res.json({ success: true, data });
    });

  router.get('/admin/overview', adminAuthenticated('admin.overview.read', (client, user) => administrator.overview(client, user)));
  router.get('/admin/users', adminAuthenticated('admin.users.read', (client, user) => administrator.users(client, user)));
  router.get('/admin/roles', adminAuthenticated('admin.roles.read', (client, user) => administrator.roles(client, user)));
  router.post('/admin/role-requests', adminAuthenticated('admin.roles.request', (client, user, req) => {
    const input = body(req, ['target_user_id', 'role_code']);
    return administrator.requestWebDevRole(client, user, input.target_user_id, input.role_code);
  }));
  router.get('/admin/education-readiness', adminAuthenticated('admin.overview.read', (_client, user) => administrator.educationReadiness(user)));

  return router;
}
