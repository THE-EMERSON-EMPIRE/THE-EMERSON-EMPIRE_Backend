import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { portalConfig } from './config';

export class PortalError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex');
export const opaqueToken = (): string => randomBytes(32).toString('base64url');
export const validToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export function constantEquals(left: unknown, right: string): boolean {
  if (typeof left !== 'string') return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function credentialVersion(password: string): string {
  return createHmac('sha256', portalConfig().secret).update('credential:v1:' + password).digest('hex');
}
export function csrfToken(raw: string): string {
  return createHmac('sha256', portalConfig().secret).update('csrf:v1:' + raw).digest('base64url');
}
export function sessionCookie(req: Request): string | null {
  if (req.headers.authorization) return null;
  const header = req.headers.cookie;
  if (!header || header.length > 4096) return null;
  const name = portalConfig().cookieName;
  const matches = header.split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return validToken(value) ? value : null;
}
export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72;
}
export function emailAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 150) return null;
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}
