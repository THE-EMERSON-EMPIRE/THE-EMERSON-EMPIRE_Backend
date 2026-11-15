import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { InvitationService } from './InvitationService';
import { requireInvitationReview } from './invitationPolicy';
import { portalOriginAllowed } from './config';
import { constantEquals, csrfToken, PortalError, sessionCookie } from './primitives';

export function createInvitationRouter(service = new InvitationService()): Router {
  const router = Router();
  const limits = (max: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Too many requests; try again later', errors: [] } });
  const wrap = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      requireInvitationReview();
      if (Object.keys(req.query).length) throw new PortalError(400, 'Query parameters are not accepted');
      if (req.headers.authorization) throw new PortalError(401, 'Authentication required');
      if (req.method !== 'GET') {
        if (!portalOriginAllowed(req.get('Origin')) || req.get('Sec-Fetch-Site') === 'cross-site' || req.get('X-EPDG-Request') !== 'portal') {
          throw new PortalError(403, 'Request verification failed');
        }
        if (!req.is('application/json')) throw new PortalError(415, 'JSON content type required');
      }
      await handler(req, res);
    })().catch(next);
  };
  const body = (req: Request, fields: string[]) => {
    const value: unknown = req.body;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) {
      throw new PortalError(400, 'Invalid request fields');
    }
    return value as Record<string, unknown>;
  };
  const session = (req: Request) => {
    const raw = sessionCookie(req);
    if (!raw) throw new PortalError(401, 'Authentication required');
    if (req.method !== 'GET' && !constantEquals(req.get('X-CSRF-Token'), csrfToken(raw))) throw new PortalError(403, 'Request verification failed');
    return raw;
  };
  router.post('/auth/accept-invitation', limits(8), wrap(async (req, res) => {
    const input = body(req, ['token','password']); await service.accept(input.token, input.password);
    res.json({ success: true, message: 'Invitation accepted; sign in with your email and password' });
  }));
  router.get('/admin/invitations', wrap(async (req, res) => { res.json({ success: true, data: await service.list(session(req)) }); }));
  router.post('/admin/invitations', limits(20), wrap(async (req, res) => {
    const raw = session(req); const input = body(req, ['user_id','role_code']);
    res.json({ success: true, data: await service.invite(raw, input.user_id, input.role_code) });
  }));
  router.post('/admin/invitations/:id/resend', limits(8), wrap(async (req, res) => {
    const raw = session(req); body(req, []);
    res.json({ success: true, data: await service.resend(raw, req.params.id) });
  }));
  return router;
}
