'use strict';

const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { rootCertificates } = require('node:tls');

const {
  getDatabaseSslConfig,
  normalizeSupabaseCaCertificate,
} = require('../dist/db/tls.js');
const { validateEnvironment } = require('../dist/config/env.js');

const validCaCertificate = rootCertificates
  .map((pem) => ({ pem, certificate: new X509Certificate(pem) }))
  .filter(({ certificate }) => (
    certificate.ca &&
    Date.parse(certificate.validFrom) <= Date.now() &&
    Date.parse(certificate.validTo) > Date.now()
  ))
  .sort((left, right) => (
    Date.parse(right.certificate.validTo) - Date.parse(left.certificate.validTo)
  ))[0]?.pem;

assert.ok(validCaCertificate, 'Node must provide at least one trusted CA fixture');

const productionEnvironment = {
  NODE_ENV: 'production',
  DB_HOST: 'database.example.invalid',
  DB_NAME: 'database',
  DB_USER: 'backend',
  DB_PASSWORD: 'test-only-password',
  JWT_SECRET: 'test-only-jwt-secret-with-at-least-32-characters',
  FRONTEND_URL: 'https://frontend.example.invalid',
  RESEND_API_KEY: 'test-only-provider-key',
  SMTP_FROM: 'sender@example.invalid',
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-key',
  CERT_SIGNING_SECRET: 'test-only-certificate-signing-secret',
  CORS_ORIGINS: 'https://frontend.example.invalid',
  SUPABASE_DB_CA_CERT: validCaCertificate,
};

test('normalizes and loads a valid CA certificate with real line breaks', () => {
  const crlfCertificate = `\r\n${validCaCertificate.replace(/\n/g, '\r\n')}\r\n`;
  const normalized = normalizeSupabaseCaCertificate(crlfCertificate);

  assert.equal(normalized.includes('\r'), false);
  assert.equal(normalized.endsWith('-----END CERTIFICATE-----\n'), true);
  assert.equal(new X509Certificate(normalized).ca, true);
});

test('normalizes and loads escaped-newline certificate formatting', () => {
  const escapedCertificate =
    `\\n${validCaCertificate.replace(/\n/g, '\\r\\n')}\\n`;
  const normalized = normalizeSupabaseCaCertificate(escapedCertificate);

  assert.equal(normalized.includes('\\n'), false);
  assert.equal(new X509Certificate(normalized).ca, true);
});

test('fails closed when the CA certificate is missing', () => {
  assert.throws(
    () => normalizeSupabaseCaCertificate(undefined),
    /Missing required environment variable: SUPABASE_DB_CA_CERT/,
  );
  assert.throws(
    () => getDatabaseSslConfig({ NODE_ENV: 'production' }),
    /Missing required environment variable: SUPABASE_DB_CA_CERT/,
  );
  assert.throws(
    () => validateEnvironment({
      ...productionEnvironment,
      SUPABASE_DB_CA_CERT: undefined,
    }),
    /Missing required environment variables: SUPABASE_DB_CA_CERT/,
  );
});

test('fails closed on malformed certificate data without echoing it', () => {
  const malformedCertificate =
    '-----BEGIN CERTIFICATE-----\\nprivate-certificate-material\\n-----END CERTIFICATE-----';

  assert.throws(
    () => normalizeSupabaseCaCertificate(malformedCertificate),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /valid PEM CA certificate/);
      assert.equal(error.message.includes('private-certificate-material'), false);
      return true;
    },
  );
  assert.throws(
    () => validateEnvironment({
      ...productionEnvironment,
      SUPABASE_DB_CA_CERT: malformedCertificate,
    }),
    /valid PEM CA certificate/,
  );
});

test('configures the PostgreSQL client with the CA and strict verification', () => {
  const ssl = getDatabaseSslConfig({
    NODE_ENV: 'production',
    SUPABASE_DB_CA_CERT: validCaCertificate,
  });

  assert.notEqual(ssl, false);
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.ca, normalizeSupabaseCaCertificate(validCaCertificate));
  assert.deepEqual(validateEnvironment(productionEnvironment), {
    nodeEnv: 'production',
    port: 8000,
  });
});

test('a configured CA always enables strict TLS even outside production', () => {
  const ssl = getDatabaseSslConfig({
    SUPABASE_DB_CA_CERT: validCaCertificate,
  });

  assert.notEqual(ssl, false);
  assert.equal(ssl.rejectUnauthorized, true);
});

test('TLS and startup source contain no insecure override or secret logging path', () => {
  const tlsSource = readFileSync(join(__dirname, '..', 'src', 'db', 'tls.ts'), 'utf8');
  const databaseSource = readFileSync(join(__dirname, '..', 'src', 'db', 'index.ts'), 'utf8');
  const startupSource = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const combined = `${tlsSource}\n${databaseSource}\n${startupSource}`;

  assert.equal(combined.includes('rejectUnauthorized: false'), false);
  assert.equal(combined.includes('NODE_TLS_REJECT_UNAUTHORIZED'), false);
  assert.equal(combined.includes('sslmode=no-verify'), false);
  assert.match(startupSource, /logger\.error\('Backend startup failed',\s*\{\s*stage,\s*errorType:/s);
  assert.equal(startupSource.includes('SUPABASE_DB_CA_CERT'), false);
});

test('database readiness completes before the HTTP listener starts', () => {
  const startupSource = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const readiness = startupSource.indexOf('await testConnection()');
  const listen = startupSource.indexOf('app.listen(');

  assert.notEqual(readiness, -1);
  assert.notEqual(listen, -1);
  assert.ok(readiness < listen);
});
