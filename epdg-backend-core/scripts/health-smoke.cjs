'use strict';

function validateApiOrigin(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('EPDG_API_ORIGIN is required.');
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('EPDG_API_ORIGIN must be a valid HTTP(S) origin.');
  }

  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || (!localHost && parsed.protocol !== 'https:')
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password
  ) {
    throw new Error('EPDG_API_ORIGIN must be a credential-free HTTPS origin (HTTP is local-only).');
  }

  return parsed.origin;
}

async function runHealthSmoke(value, fetchImpl = fetch) {
  const origin = validateApiOrigin(value);
  const response = await fetchImpl(`${origin}/health`, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status !== 200) {
    throw new Error(`Readiness returned unexpected status ${response.status}.`);
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('Readiness did not return JSON.');
  }

  const body = await response.json();
  if (
    body?.success !== true
    || body?.service !== 'epdg-backend-core'
    || body?.status !== 'ok'
  ) {
    throw new Error('Readiness returned an unexpected response contract.');
  }

  return { status: response.status };
}

async function main() {
  try {
    const result = await runHealthSmoke(process.env.EPDG_API_ORIGIN);
    console.log(`EPDG readiness smoke passed (${result.status}).`);
  } catch (error) {
    console.error('EPDG readiness smoke failed.', {
      errorType: error instanceof Error ? error.name : 'Error',
    });
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = { runHealthSmoke, validateApiOrigin };
