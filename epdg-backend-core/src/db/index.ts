import { Pool } from 'pg';
import { getDatabaseSslConfig } from './tls';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: getDatabaseSslConfig(),
      options: '-c search_path=epdg,public',
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5000),
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15000),
    });
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
