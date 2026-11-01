import express, { Router, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { PortalError } from '../security/primitives';
import { HandoffConfig, handoffConfig, handoffKeyId, hostedHandoffKeyId, handoffPath } from './config';
import { parseHandoffEvent, verifyHandoffSignature } from './contract';
import { HandoffService } from './HandoffService';
import { isHostedPractice } from '../hosted-practice/profile';

export function verifyServiceRequest(req: Request, config: HandoffConfig): void {
  const hosted = config.hosted;
  if (req.method !== 'POST' || req.originalUrl !== handoffPath || Object.keys(req.query).length ||
      (hosted ? req.get('Host') !== new URL(hosted.backendOrigin).host || req.get('X-Forwarded-Proto') !== 'https'
        : req.socket.remoteAddress !== '127.0.0.1' || req.get('Host') !== '127.0.0.1:58000')) {
    throw new PortalError(403, 'Service request verification failed');
  }
  const names = new Set<string>();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index].toLowerCase();
    if (names.has(name) || ['origin', 'cookie', 'authorization', 'x-epdg-request', 'forwarded'].includes(name) ||
        name.startsWith('sec-fetch-') || (!hosted && name.startsWith('x-forwarded-')) ||
        (hosted && name.startsWith('x-forwarded-') && !['x-forwarded-proto','x-forwarded-host','x-forwarded-for','x-forwarded-port'].includes(name))) {
      throw new PortalError(403, 'Service request verification failed');
    }
    names.add(name);
  }
  if (hosted && ((req.get('X-Forwarded-Host') && req.get('X-Forwarded-Host') !== new URL(hosted.backendOrigin).host) ||
      (req.get('X-Forwarded-Port') && req.get('X-Forwarded-Port') !== '443') ||
      req.get('X-EPDG-Handoff-Audience') !== hosted.backendOrigin || req.get('X-EPDG-Handoff-Source') !== hosted.crmOrigin)) {
    throw new PortalError(403, 'Service request verification failed');
  }
  if (req.get('X-EPDG-Handoff-Key-Id') !== (hosted ? hostedHandoffKeyId : handoffKeyId)) throw new PortalError(401, 'Handoff authentication required');
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.get('Content-Type') ?? '') || req.get('Content-Encoding')) {
    throw new PortalError(415, 'JSON content type required');
  }
}

export function createHandoffRouter(service = new HandoffService()): Router {
  const router = Router();
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
    ...(isHostedPractice() ? { keyGenerator: () => 'hosted-practice-handoff' } : {}),
    message: { success: false, message: 'Too many requests; try again later', errors: [] } });
  router.use((req, _res, next) => {
    try { const config = handoffConfig(); config.key.fill(0); verifyServiceRequest(req, config); next(); }
    catch (error) { next(error); }
  });
  router.use(limiter);
  router.use(express.raw({ type: () => true, limit: 8192, inflate: false }));
  router.post('/', (req, res, next) => {
    void (async () => {
      const config = handoffConfig();
      try {
        if (!Buffer.isBuffer(req.body)) throw new PortalError(400, 'Invalid synthetic handoff envelope');
        const auth = verifyHandoffSignature(config.key, req.get('X-EPDG-Handoff-Timestamp'),
          req.get('X-EPDG-Handoff-Nonce'), req.get('X-EPDG-Handoff-Signature'), req.body, Date.now(), config.hosted);
        const event = parseHandoffEvent(req.body, config.hosted ? 'synthetic-hosted' : 'synthetic-local');
        res.json(await service.receive(event, auth.digest, auth.nonce));
      } finally { config.key.fill(0); if (Buffer.isBuffer(req.body)) req.body.fill(0); }
    })().catch(next);
  });
  return router;
}
