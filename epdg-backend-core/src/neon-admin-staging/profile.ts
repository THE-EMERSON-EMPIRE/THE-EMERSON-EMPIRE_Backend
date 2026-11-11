import configured from './profile.json';

export interface NeonAdminStagingProfile {
  version: 1;
  enabled: true;
  projectId: string;
  branchId: string;
  branchName: 'staging';
  region: 'aws-us-east-1';
  databaseName: 'emerson_epdg_portal_app';
  databaseHost: string;
  migratorRole: 'epdg_portal_migrator';
  runtimeRole: 'epdg_portal_runtime';
}

const unavailable = () => new Error('Isolated Neon administrator staging configuration is unavailable');
export const isNeonAdminStaging = (env: NodeJS.ProcessEnv = process.env): boolean => env.EPDG_NEON_ADMIN_STAGING_MODE === '1';

function exactOrigin(value: string | undefined, production: boolean): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
    if (production) return url.protocol === 'https:';
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Source-pinned, synthetic-only profile for the dedicated EPDG administrator staging branch. */
export function validateNeonAdminStagingEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  candidate: unknown = configured,
): NeonAdminStagingProfile {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw unavailable();
  const profile = candidate as NeonAdminStagingProfile;
  if (profile.version !== 1 || profile.enabled !== true || profile.branchName !== 'staging' ||
      profile.region !== 'aws-us-east-1' || profile.databaseName !== 'emerson_epdg_portal_app' ||
      profile.migratorRole !== 'epdg_portal_migrator' || profile.runtimeRole !== 'epdg_portal_runtime' ||
      !/^[a-z0-9-]+$/.test(profile.projectId) || !/^br-[a-z0-9-]+$/.test(profile.branchId) ||
      !/^[a-z0-9-]+\.c-16\.us-east-1\.aws\.neon\.tech$/.test(profile.databaseHost)) throw unavailable();

  const nodeEnv = env.NODE_ENV;
  const production = nodeEnv === 'production';
  const expected: Record<string, string> = {
    EPDG_NEON_ADMIN_STAGING_MODE: '1', EPDG_SYNTHETIC_MODE: '1', EPDG_ADMIN_STAGING_MODE: '1',
    NEON_ADMIN_STAGING_PROJECT_ID: profile.projectId, NEON_ADMIN_STAGING_BRANCH_ID: profile.branchId,
    DB_HOST: profile.databaseHost, DB_PORT: '5432', DB_NAME: profile.databaseName,
    DB_USER: profile.runtimeRole, DB_SSL: 'true',
  };
  if (!['production', 'test'].includes(nodeEnv ?? '') ||
      Object.entries(expected).some(([name, value]) => env[name] !== value) ||
      typeof env.DB_PASSWORD !== 'string' || env.DB_PASSWORD.length < 32 ||
      typeof env.SESSION_CSRF_SECRET !== 'string' || env.SESSION_CSRF_SECRET.length < 32 ||
      env.SESSION_CSRF_SECRET === env.DB_PASSWORD) throw unavailable();

  const origin = env.PORTAL_ORIGIN;
  const origins = (env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!exactOrigin(origin, production) || origins.length !== 1 || origins[0] !== origin) throw unavailable();

  const forbidden = [
    'EPDG_HOSTED_PRACTICE_MODE', 'EPDG_HOSTED_PRACTICE_LOGIN_ALIAS', 'EPDG_HOSTED_PRACTICE_BOOTSTRAP',
    'SYNTHETIC_INSTANCE_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY',
    'SUPABASE_DB_CA_CERT', 'RESEND_API_KEY', 'DATABASE_URL', 'DATABASE_PUBLIC_URL', 'PGHOST', 'PGPORT',
    'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'POSTGRES_PASSWORD', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER',
    'SMTP_PASSWORD', 'JWT_SECRET', 'CERT_SIGNING_SECRET',
  ];
  if (forbidden.some(name => Boolean(env[name])) || env.MAIL_DELIVERY_MODE || env.FRONTEND_URL) throw unavailable();
  return Object.freeze({ ...profile });
}
