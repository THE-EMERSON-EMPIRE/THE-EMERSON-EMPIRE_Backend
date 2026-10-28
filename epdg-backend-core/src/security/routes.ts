import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { PortalService } from './PortalService';
import { portalConfig, portalOriginAllowed } from './config';
import { constantEquals, csrfToken, emailAddress, PortalError, sessionCookie } from './primitives';
import { LearningService } from '../learning/LearningService';
import { MentorReviewService } from '../learning/MentorReviewService';
import multer from 'multer';
import { attachmentLimit, attachmentMediaType, multipartRevision } from '../learning/attachments';
import { isHostedPractice } from '../hosted-practice/profile';
import { resolvePracticeEmail } from '../hosted-practice/loginAlias';

type Handler = (req: Request, res: Response) => Promise<void>;
const disabled = (_req: Request, res: Response) => { res.status(503).json({ success: false, message: 'Unavailable pending security review', errors: [] }); };
function body(req: Request, keys: string[]): Record<string, unknown> {
  const value: unknown = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new PortalError(400, 'Invalid request fields');
  }
  return value as Record<string, unknown>;
}
export function createPortalRouter(): Router {
  const router = Router();
  const service = new PortalService();
  const learning = new LearningService(service);
  const mentor = new MentorReviewService(service);
  // This parser is invoked only after current session/CSRF and synthetic scope
  // checks. No disk storage, global multipart middleware or public file URL.
  // Multer 2.5 documents this additional limit; existing @types/multer 2.1
  // lacks it, so retain the narrow explicit extension without a types upgrade.
  const uploadLimits: NonNullable<multer.Options['limits']> & { fieldArrayIndexLimit: number; fieldNestingDepth: number } = {
    fileSize: attachmentLimit, files: 1, fields: 1, parts: 2, fieldNameSize: 32, fieldSize: 10, headerPairs: 20,
    fieldArrayIndexLimit: 0, fieldNestingDepth: 0 };
  const upload = multer({ storage: multer.memoryStorage(), preservePath: true,
    limits: uploadLimits,
    fileFilter: (_req, file, done) => {
      try { attachmentMediaType(file.originalname, file.mimetype); done(null, true); }
      catch (error) { done(error as Error); }
    } }).single('file');
  const parseUpload = (req: Request, res: Response) => new Promise<void>((resolve, reject) => {
    upload(req, res, error => {
      if (!error) { resolve(); return; }
      if (error instanceof PortalError) { reject(error); return; }
      reject(new PortalError(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
        error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 1 MiB limit' : 'Invalid bounded multipart upload'));
    });
  });
  const limits = (max: number, windowMs = 15 * 60 * 1000) => rateLimit({ windowMs, limit: max,
    ...(isHostedPractice() ? { keyGenerator: () => 'hosted-practice-portal' } : {}),
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Too many requests; try again later', errors: [] } });
  const wrap = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(error => {
      if (error instanceof PortalError && error.statusCode === 401 && req.headers.cookie) {
        const config = portalConfig(); res.clearCookie(config.cookieName, { ...config.cookie, maxAge: undefined });
      }
      next(error);
    });
  };
  const authenticated = (handler: (req: Request, res: Response, raw: string, session: Awaited<ReturnType<PortalService['session']>>) => Promise<void>) => wrap(async (req, res) => {
    const raw = sessionCookie(req);
    if (!raw) throw new PortalError(401, 'Authentication required');
    const session = await service.session(raw);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !constantEquals(req.get('X-CSRF-Token'), csrfToken(raw))) {
      throw new PortalError(403, 'Request verification failed');
    }
    await handler(req, res, raw, session);
  });

  // No public self-registration, JWT refresh, invitations, owner or role mutation.
  router.use(['/auth/register', '/auth/refresh', '/auth/verify-email', '/auth/resend-verification',
    '/invitations', '/owner', '/memberships'], disabled);
  router.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    try {
      if (req.headers.authorization) throw new PortalError(401, 'Authentication required');
      if (!portalOriginAllowed(req.get('Origin')) || req.get('Sec-Fetch-Site') === 'cross-site' ||
          req.get('X-EPDG-Request') !== 'portal') throw new PortalError(403, 'Request verification failed');
      const attachmentPost = req.method === 'POST' && /^\/learner\/assignments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/attachments$/i.test(req.path);
      if (attachmentPost ? !req.is('multipart/form-data') : !req.is('application/json')) {
        throw new PortalError(415, attachmentPost ? 'Multipart content type required' : 'JSON content type required');
      }
      next();
    } catch (error) { next(error); }
  });
  router.post('/auth/login', limits(20), wrap(async (req, res) => {
    const input = body(req, ['email', 'password']); const email = emailAddress(input.email);
    if (!email || typeof input.password !== 'string' || input.password.length < 1 || Buffer.byteLength(input.password) > 72) {
      throw new PortalError(400, 'Valid email and bounded password are required');
    }
    const result = await service.login(resolvePracticeEmail(email), input.password, sessionCookie(req));
    const config = portalConfig(); res.cookie(config.cookieName, result.token, config.cookie);
    res.json({ success: true, user: result.user, expires_at: result.expiresAt, csrf_token: csrfToken(result.token) });
  }));
  const sessionResponse = authenticated(async (req, res, raw, session) => {
    if (Object.keys(req.query).length) throw new PortalError(400, 'Query parameters are not accepted');
    res.json({ success: true, user: session.user, expires_at: session.expiresAt, csrf_token: csrfToken(raw) });
  });
  router.get(['/auth/session', '/auth/me'], sessionResponse);
  router.post('/auth/logout', authenticated(async (req, res, raw) => {
    body(req, []); await service.logout(raw);
    const config = portalConfig(); res.clearCookie(config.cookieName, { ...config.cookie, maxAge: undefined });
    res.json({ success: true });
  }));
  router.post('/auth/change-password', limits(8), authenticated(async (req, res, raw) => {
    const input = body(req, ['current_password', 'new_password']);
    if (typeof input.current_password !== 'string' || Buffer.byteLength(input.current_password) > 72 || typeof input.new_password !== 'string') {
      throw new PortalError(400, 'Invalid password request');
    }
    await service.changePassword(raw, input.current_password, input.new_password);
    const config = portalConfig(); res.clearCookie(config.cookieName, { ...config.cookie, maxAge: undefined });
    res.json({ success: true, message: 'Password changed; sign in again' });
  }));
  router.post('/auth/forgot-password', limits(5), wrap(async (req, res) => {
    const started = Date.now(); const input = body(req, ['email']); const email = emailAddress(input.email);
    if (!email) throw new PortalError(400, 'Valid email required');
    await service.requestRecovery(resolvePracticeEmail(email));
    // A bounded response floor reduces trivial account timing differences; no provider wait.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 200 - (Date.now() - started))));
    res.json({ success: true, message: 'If the account is eligible, recovery instructions will be sent' });
  }));
  router.post('/auth/reset-password', limits(8), wrap(async (req, res) => {
    const input = body(req, ['token', 'password']);
    if (typeof input.token !== 'string' || typeof input.password !== 'string') throw new PortalError(400, 'Invalid recovery request');
    await service.resetPassword(input.token, input.password);
    const config = portalConfig(); res.clearCookie(config.cookieName, { ...config.cookie, maxAge: undefined });
    res.json({ success: true, message: 'Password reset; sign in again' });
  }));
  router.get('/access', authenticated(async (req, res, _raw, session) => {
    if (Object.keys(req.query).length) throw new PortalError(400, 'Query parameters are not accepted');
    res.json({ success: true, memberships: session.user.memberships, permissions: [], privileged_controls_available: false });
  }));
  router.all('/access/:permission', authenticated(async () => { throw new PortalError(403, 'Permission unavailable'); }));
  router.patch('/profile', authenticated(async () => { throw new PortalError(403, 'Profile editing is unavailable pending an approved field policy'); }));
  const noQuery = (req: Request) => {
    if (Object.keys(req.query).length) throw new PortalError(400, 'Query parameters are not accepted');
  };
  router.get('/learner/dashboard', authenticated(async (req, res, raw) => {
    noQuery(req); res.json(await learning.dashboard(raw));
  }));
  router.get('/learner/onboarding', authenticated(async (req, res, raw) => {
    noQuery(req); res.json(await learning.onboarding(raw));
  }));
  router.get('/learner/programs/:id', authenticated(async (req, res, raw) => {
    noQuery(req); res.json(await learning.program(raw, req.params.id));
  }));
  router.post('/learner/items/:id/complete', limits(60), authenticated(async (req, res, raw) => {
    noQuery(req); body(req, []); res.json(await learning.complete(raw, req.params.id));
  }));
  router.get('/learner/assignments/:id/submission', authenticated(async (req, res, raw) => {
    noQuery(req); res.json(await learning.submission(raw, req.params.id));
  }));
  router.get('/learner/assignments/:id/feedback', authenticated(async (req, res, raw) => {
    noQuery(req); res.json(await learning.assignmentFeedback(raw, req.params.id));
  }));
  router.get('/learner/assignments/:id/attempts', authenticated(async (req, res, raw) => {
    noQuery(req); res.json(await learning.attempts(raw, req.params.id));
  }));
  router.post('/learner/assignments/:id/start-revision', limits(120), authenticated(async (req, res, raw) => {
    noQuery(req); const input = body(req, ['expected_receipt_id', 'expected_revision']);
    res.json(await learning.startRevision(raw, req.params.id, input.expected_receipt_id, input.expected_revision));
  }));
  router.get('/learner/assignments/:id/attempts/:receiptId/attachments/:attachmentId/download', authenticated(async (req, res, raw) => {
    noQuery(req); const file = await learning.downloadAttemptAttachment(raw, req.params.id, req.params.receiptId, req.params.attachmentId);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${file.filename}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'no-store' });
    res.send(file.bytes);
  }));
  router.post('/learner/assignments/:id/draft', limits(120), authenticated(async (req, res, raw) => {
    noQuery(req); const input = body(req, ['answer', 'expected_revision']);
    res.json(await learning.saveDraft(raw, req.params.id, input.answer, input.expected_revision));
  }));
  router.post('/learner/assignments/:id/submit', limits(120), authenticated(async (req, res, raw) => {
    noQuery(req); const input = body(req, ['expected_revision']);
    res.json(await learning.submitAssignment(raw, req.params.id, input.expected_revision));
  }));
  router.post('/learner/assignments/:id/attachments', limits(120), authenticated(async (req, res, raw) => {
    noQuery(req);
    const size = req.get('Content-Length');
    if (size && (!/^[0-9]+$/.test(size) || Number(size) > attachmentLimit + 8192)) throw new PortalError(413, 'Multipart request exceeds its limit');
    await learning.attachmentUploadPreflight(raw, req.params.id);
    try {
      await parseUpload(req, res);
      const input = body(req, ['expected_revision']);
      if (!req.file) throw new PortalError(400, 'One supported fictional file is required');
      res.json(await learning.uploadAttachment(raw, req.params.id, multipartRevision(input.expected_revision),
        req.file.originalname, req.file.mimetype, req.file.buffer));
    } finally { req.file?.buffer?.fill(0); }
  }));
  for (const operation of ['remove', 'restore'] as const) router.post(`/learner/assignments/:id/attachments/:attachmentId/${operation}`,
    limits(120), authenticated(async (req, res, raw) => {
      noQuery(req); const input = body(req, ['expected_revision']);
      res.json(await learning.setAttachmentRemoved(raw, req.params.id, req.params.attachmentId, input.expected_revision, operation === 'remove'));
    }));
  router.get('/learner/assignments/:id/attachments/:attachmentId/download', authenticated(async (req, res, raw) => {
    noQuery(req); const file = await learning.downloadAttachment(raw, req.params.id, req.params.attachmentId);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${file.filename}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'no-store' });
    res.send(file.bytes);
  }));
  router.get('/mentor/reviews', authenticated(async (req, res, raw) => {
    noQuery(req); res.json(await mentor.queue(raw));
  }));
  router.get('/mentor/reviews/:receiptId', authenticated(async (req, res, raw) => {
    noQuery(req); res.json(await mentor.review(raw, req.params.receiptId));
  }));
  router.post('/mentor/reviews/:receiptId/draft', limits(120), authenticated(async (req, res, raw) => {
    noQuery(req); const input = body(req, ['comment', 'expected_revision']);
    res.json(await mentor.saveDraft(raw, req.params.receiptId, input.comment, input.expected_revision));
  }));
  router.post('/mentor/reviews/:receiptId/publish', limits(120), authenticated(async (req, res, raw) => {
    noQuery(req); const input = body(req, ['expected_revision']);
    res.json(await mentor.publish(raw, req.params.receiptId, input.expected_revision));
  }));
  router.get('/mentor/reviews/:receiptId/attachments/:attachmentId/download', authenticated(async (req, res, raw) => {
    noQuery(req); const file = await mentor.download(raw, req.params.receiptId, req.params.attachmentId);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${file.filename}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'no-store' });
    res.send(file.bytes);
  }));
  router.use(['/admin', '/mentor', '/intern', '/onboarding', '/upload', '/users'], authenticated(async (req, res) => { disabled(req, res); }));
  return router;
}
