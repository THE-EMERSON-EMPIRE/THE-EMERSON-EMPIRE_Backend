import { X509Certificate } from 'node:crypto';
import { isHostedPractice, validateHostedPracticeEnvironment } from '../hosted-practice/profile';
import { normalizeHostedPracticeCa } from '../hosted-practice/tls';
import { isNeonAdminStaging, validateNeonAdminStagingEnvironment } from '../neon-admin-staging/profile';

const PEM_BEGIN = '-----BEGIN CERTIFICATE-----';
const PEM_END = '-----END CERTIFICATE-----';

export interface StrictDatabaseTlsConfig {
  /** Neon staging uses Node's normal system trust store; Supabase profiles pin an explicit CA. */
  ca?: string;
  rejectUnauthorized: true;
}

function invalidCertificateError(): Error {
  return new Error('SUPABASE_DB_CA_CERT must contain a valid PEM CA certificate.');
}

export function normalizeSupabaseCaCertificate(
  value: string | undefined,
): string {
  if (!value?.trim()) {
    throw new Error('Missing required environment variable: SUPABASE_DB_CA_CERT');
  }

  const normalized = value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const hasSingleCertificate =
    normalized.startsWith(`${PEM_BEGIN}\n`) &&
    normalized.endsWith(`\n${PEM_END}`) &&
    normalized.indexOf(PEM_BEGIN) === normalized.lastIndexOf(PEM_BEGIN) &&
    normalized.indexOf(PEM_END) === normalized.lastIndexOf(PEM_END);

  if (!hasSingleCertificate) {
    throw invalidCertificateError();
  }

  try {
    const certificate = new X509Certificate(normalized);
    const now = Date.now();
    const validFrom = Date.parse(certificate.validFrom);
    const validTo = Date.parse(certificate.validTo);
    if (
      !certificate.ca ||
      !Number.isFinite(validFrom) ||
      !Number.isFinite(validTo) ||
      validFrom > now ||
      validTo <= now
    ) {
      throw invalidCertificateError();
    }
  } catch {
    throw invalidCertificateError();
  }

  return `${normalized}\n`;
}

export function requiresDatabaseTls(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.DB_SSL === 'true' ||
    env.NODE_ENV === 'production' ||
    Boolean(env.SUPABASE_DB_CA_CERT?.trim()) ||
    env.DB_HOST?.endsWith('.supabase.com') === true ||
    env.DB_HOST?.endsWith('.supabase.co') === true ||
    (isNeonAdminStaging(env) && env.DB_HOST?.endsWith('.aws.neon.tech') === true)
  );
}

export function getDatabaseSslConfig(
  env: NodeJS.ProcessEnv = process.env,
): false | StrictDatabaseTlsConfig {
  if (isHostedPractice(env)) {
    validateHostedPracticeEnvironment(env);
    return { ca: normalizeHostedPracticeCa(env.HOSTED_PRACTICE_DB_CA_CERT), rejectUnauthorized: true };
  }
  if (isNeonAdminStaging(env)) {
    validateNeonAdminStagingEnvironment(env);
    return { rejectUnauthorized: true };
  }
  if (!requiresDatabaseTls(env)) {
    return false;
  }

  return {
    ca: normalizeSupabaseCaCertificate(env.SUPABASE_DB_CA_CERT),
    rejectUnauthorized: true,
  };
}
