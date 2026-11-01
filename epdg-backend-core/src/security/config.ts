import type { CookieOptions } from 'express';
import { validateSyntheticEnvironment } from '../config/synthetic';
import { isHostedPractice, validateHostedPracticeEnvironment } from '../hosted-practice/profile';

export function portalConfig(env: NodeJS.ProcessEnv = process.env) {
  const local = env.EPDG_SYNTHETIC_MODE === '1';
  if (local) validateSyntheticEnvironment(env);
  if (isHostedPractice(env)) validateHostedPracticeEnvironment(env);
  if (!local && env.NODE_ENV !== 'production') throw new Error('Portal requires production or the isolated synthetic runner');
  const origin = env.PORTAL_ORIGIN;
  const secret = env.SESSION_CSRF_SECRET;
  if (!origin || !secret || secret.length < 32) throw new Error('PORTAL_ORIGIN and SESSION_CSRF_SECRET are required');
  if (secret === env.JWT_SECRET || secret === env.CERT_SIGNING_SECRET) throw new Error('SESSION_CSRF_SECRET must be independently generated');
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || (!local && url.protocol !== 'https:') ||
      (local && origin !== 'http://127.0.0.1:58080')) throw new Error('Invalid portal origin');
  const seconds = (name: string, fallback: number, max: number): number => {
    const value = env[name] === undefined || env[name]?.trim() === '' ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < 60 || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  const absoluteSeconds = seconds('SESSION_ABSOLUTE_SECONDS', 8 * 3600, 12 * 3600);
  const idleSeconds = seconds('SESSION_IDLE_SECONDS', 30 * 60, absoluteSeconds);
  return { origin, secret, absoluteSeconds, idleSeconds,
    cookieName: local ? 'epdg_synthetic_session' : '__Host-epdg_session',
    cookie: { httpOnly: true, secure: !local, sameSite: 'strict', path: '/', maxAge: absoluteSeconds * 1000 } as CookieOptions };
}

export function portalOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isHostedPractice(env)) return typeof origin === 'string' && validateHostedPracticeEnvironment(env).frontendOrigins.includes(origin);
  return origin === portalConfig(env).origin;
}
