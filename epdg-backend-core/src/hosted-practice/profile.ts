import configured from './profile.json';
import { normalizeHostedPracticeCa } from './tls';

export interface HostedPracticeProfile {
  version: 1; enabled: true; projectId: string; environmentId: string; serviceId: string;
  databaseServiceId: string; databaseHost: string; databasePort: number;
  databaseName: 'epdg_synthetic'; databaseUser: 'epdg_synthetic_app'; instanceId: string;
  frontendOrigin: string; frontendOrigins: string[]; backendOrigin: string; crmOrigin: string;
  loginAlias: string;
  baselineSha256: string; isolationSha256: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const unavailable = () => new Error('Hosted practice configuration is unavailable');
export const isHostedPractice = (env: NodeJS.ProcessEnv = process.env): boolean => env.EPDG_HOSTED_PRACTICE_MODE === '1';

function origin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password; }
  catch { return false; }
}
/** Source-pinned identity. Environment variables cannot nominate another project, database or recipient. */
export function validateHostedPracticeEnvironment(env: NodeJS.ProcessEnv = process.env,
  candidate: unknown = configured): HostedPracticeProfile {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw unavailable();
  const p = candidate as HostedPracticeProfile;
  if (p.version !== 1 || p.enabled !== true ||
      ![p.projectId, p.environmentId, p.serviceId, p.databaseServiceId, p.instanceId].every(value => typeof value === 'string' && uuid.test(value)) ||
      typeof p.databaseHost !== 'string' || !/^[a-z0-9][a-z0-9-]*\.railway\.internal$/.test(p.databaseHost) ||
      p.databasePort !== 5432 || p.databaseName !== 'epdg_synthetic' || p.databaseUser !== 'epdg_synthetic_app' ||
      ![p.frontendOrigin, p.backendOrigin, p.crmOrigin].every(origin) || p.backendOrigin === p.crmOrigin ||
      !Array.isArray(p.frontendOrigins) || p.frontendOrigins.length < 1 || p.frontendOrigins.length > 3 ||
      p.frontendOrigins[0] !== p.frontendOrigin || new Set(p.frontendOrigins).size !== p.frontendOrigins.length ||
      !p.frontendOrigins.every(origin) ||
      p.loginAlias !== 'admin@theemersonempire.info' ||
      ![p.baselineSha256, p.isolationSha256].every(value => typeof value === 'string' && digest.test(value))) throw unavailable();
  const exact: Record<string, string> = {
    EPDG_HOSTED_PRACTICE_MODE: '1', NODE_ENV: 'production', RAILWAY_PROJECT_ID: p.projectId,
    RAILWAY_ENVIRONMENT_ID: p.environmentId, RAILWAY_SERVICE_ID: p.serviceId,
    DB_HOST: p.databaseHost, DB_PORT: String(p.databasePort), DB_NAME: p.databaseName, DB_USER: p.databaseUser,
    DB_SSL: 'true', HOSTED_PRACTICE_INSTANCE_ID: p.instanceId, PORTAL_ORIGIN: p.frontendOrigin,
    FRONTEND_URL: p.frontendOrigin, CORS_ORIGINS: p.frontendOrigins.join(','),
    EPDG_HOSTED_PRACTICE_LOGIN_ALIAS: p.loginAlias,
    MAIL_DELIVERY_MODE: 'database-capture', SMTP_FROM: 'EPDG Synthetic <no-reply@epdg.invalid>',
  };
  if (Object.entries(exact).some(([name, value]) => env[name] !== value)) throw unavailable();
  const forbidden = ['EPDG_SYNTHETIC_MODE', 'SYNTHETIC_INSTANCE_ID', 'RESEND_API_KEY', 'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_DB_CA_CERT', 'DATABASE_URL', 'DATABASE_PUBLIC_URL',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'JWT_SECRET', 'CERT_SIGNING_SECRET',
    'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'POSTGRES_PASSWORD', 'POSTGRES_USER', 'POSTGRES_DB',
    'OPERATOR_DB_PASSWORD', 'EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD', 'EPDG_HOSTED_PRACTICE_BOOTSTRAP',
    'HOSTED_PRACTICE_APP_PASSWORD', 'HOSTED_PRACTICE_FIXTURE_PASSWORD'];
  if (forbidden.some(name => Boolean(env[name])) || typeof env.DB_PASSWORD !== 'string' || env.DB_PASSWORD.length < 32 ||
      typeof env.SESSION_CSRF_SECRET !== 'string' || env.SESSION_CSRF_SECRET.length < 32 ||
      env.SESSION_CSRF_SECRET === env.DB_PASSWORD) throw unavailable();
  normalizeHostedPracticeCa(env.HOSTED_PRACTICE_DB_CA_CERT);
  return Object.freeze({ ...p, frontendOrigins: Object.freeze([...p.frontendOrigins]) as unknown as string[] });
}
