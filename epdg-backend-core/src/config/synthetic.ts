/** Explicit local test contract. Never a production configuration option. */
export function validateSyntheticEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const exact: Record<string, string> = {
    EPDG_SYNTHETIC_MODE: '1', NODE_ENV: 'test', DB_HOST: '127.0.0.1',
    DB_PORT: '55432', DB_NAME: 'epdg_synthetic', DB_USER: 'epdg_synthetic_app',
    DB_SSL: 'false', MAIL_DELIVERY_MODE: 'mailpit', SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '51025', FRONTEND_URL: 'http://127.0.0.1:58080',
    CORS_ORIGINS: 'http://127.0.0.1:58080', SUPABASE_URL: 'http://127.0.0.1:55439',
    SMTP_FROM: 'EPDG Synthetic <no-reply@epdg.invalid>',
  };
  for (const [name, value] of Object.entries(exact)) {
    if (env[name] !== value) throw new Error(`Unsafe synthetic setting: ${name}`);
  }
  if (!/^[0-9a-f-]{36}$/.test(env.SYNTHETIC_INSTANCE_ID ?? '')) {
    throw new Error('Missing synthetic instance identity');
  }
  for (const name of ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY',
    'SUPABASE_DB_CA_CERT', 'DATABASE_URL', 'SMTP_USER', 'SMTP_PASSWORD']) {
    if (env[name]) throw new Error(`Forbidden credential in synthetic mode: ${name}`);
  }
}
