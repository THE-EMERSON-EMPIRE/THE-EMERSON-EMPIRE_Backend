'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { gzipSync, deflateSync } = require('node:zlib');

process.env.NODE_ENV = 'production';
process.env.PORTAL_ORIGIN = 'https://portal.example.invalid';
process.env.SESSION_CSRF_SECRET = 'unit-only-independent-csrf-secret-at-least-32-characters';
delete process.env.EPDG_SYNTHETIC_MODE;
delete process.env.EPDG_HOSTED_PRACTICE_MODE;

const { createApp } = require('../dist/app.js');
const { PortalService } = require('../dist/security/PortalService.js');
const { PortalError } = require('../dist/security/primitives.js');

test('production rejects compressed JSON before authentication and retains bounded plain JSON', { timeout: 15000 }, async (t) => {
  const calls = [];
  const originalLogin = PortalService.prototype.login;
  PortalService.prototype.login = async (...args) => {
    calls.push(args);
    throw new PortalError(401, 'Invalid email or password');
  };
  t.after(() => { PortalService.prototype.login = originalLogin; });

  const app = createApp({ readinessCheck: async () => undefined });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const input = { email: 'compression-test@example.invalid', password: 'unit-only-password' };
  const plain = Buffer.from(JSON.stringify(input));
  const request = (body, headers = {}) => fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(3000),
  });

  // Ordinary valid compressed JSON is enough to prove rejection before the
  // decompressor, origin checks or login service. No malicious trailing frame.
  for (const [encoding, compressed] of [['gzip', gzipSync(plain)], ['deflate', deflateSync(plain)]]) {
    const response = await request(compressed, { 'Content-Encoding': encoding });
    assert.equal(response.status, 415, encoding);
    assert.deepEqual(await response.json(), { success: false, message: 'Unsupported content type', errors: [] });
    assert.equal(calls.length, 0);
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
  }

  const allowedHeaders = { Origin: process.env.PORTAL_ORIGIN, 'X-EPDG-Request': 'portal' };
  for (const headers of [allowedHeaders, { ...allowedHeaders, 'Content-Encoding': 'identity' }]) {
    const response = await request(plain, headers);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, 'Invalid email or password');
  }
  assert.deepEqual(calls, [[input.email, input.password, null], [input.email, input.password, null]]);

  const oversized = await request(Buffer.from(JSON.stringify({ password: 'x'.repeat(16 * 1024) })), allowedHeaders);
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).message, 'Request body too large');
  assert.equal(calls.length, 2);
});
