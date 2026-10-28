import { Pool } from 'pg';
import { getDatabaseSslConfig } from './tls';
import { isHostedPractice, validateHostedPracticeEnvironment } from '../hosted-practice/profile';
import { initializeSupabasePool } from './supabase-session';

export function databaseSearchPath(env: NodeJS.ProcessEnv = process.env): string {
  if (isHostedPractice(env) && validateHostedPracticeEnvironment(env).version === 2) {
    // pg_temp is explicitly last: inherited managed-database TEMP cannot shadow
    // a qualified app relation or the explicitly first pg_catalog functions.
    return 'pg_catalog,epdg,pg_temp';
  }
  return 'epdg,public';
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    const next = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: getDatabaseSslConfig(),
      options: `-c search_path=${databaseSearchPath()}`,
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5000),
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15000),
    });
    if (isHostedPractice() && validateHostedPracticeEnvironment().version === 2) initializeSupabasePool(next);
    pool = next;
  }
  return pool;
}

export async function testConnection(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
