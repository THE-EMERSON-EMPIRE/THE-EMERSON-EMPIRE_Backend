import type { Pool, PoolClient } from 'pg';
import { PortalError } from '../security/primitives';

const unavailable = () => new PortalError(503, 'Database session configuration is unavailable');
type SessionClient = Pick<PoolClient, 'query'>;
type SessionOptions = { readOnly?: boolean; statementTimeoutMs?: 10000 | 15000 | 30000 };

/** Supavisor may ignore startup options. Await and verify explicit session state. */
export async function initializeSupabaseSession(client: SessionClient, options: SessionOptions = {}): Promise<void> {
  const { readOnly = false, statementTimeoutMs = 15000 } = options;
  if (typeof readOnly !== 'boolean' || ![10000, 15000, 30000].includes(statementTimeoutMs)) throw unavailable();
  try {
    await client.query('SET SESSION search_path TO pg_catalog,epdg,pg_temp');
    await client.query(`SET SESSION default_transaction_read_only TO ${readOnly ? 'on' : 'off'}`);
    await client.query(`SET SESSION statement_timeout TO ${statementTimeoutMs}`);
    const { rows } = await client.query(`SELECT current_setting('search_path') AS search_path,
      current_setting('default_transaction_read_only') AS read_only,current_setting('statement_timeout') AS statement_timeout`);
    if (rows.length !== 1 || typeof rows[0].search_path !== 'string' ||
        rows[0].search_path.replace(/\s/g, '') !== 'pg_catalog,epdg,pg_temp' || rows[0].read_only !== (readOnly ? 'on' : 'off') ||
        rows[0].statement_timeout !== `${statementTimeoutMs / 1000}s`) throw unavailable();
  } catch { throw unavailable(); }
}

/** Gate both Pool.connect overloads, including Pool.query's internal callback. */
export function initializeSupabasePool(pool: Pool): void {
  const acquire = pool.connect.bind(pool) as () => Promise<PoolClient>;
  type Callback = (error: Error | null, client?: PoolClient, release?: (error?: Error | boolean) => void) => void;
  pool.connect = ((callback?: Callback) => {
    const ready = Promise.resolve().then(acquire).then(async client => {
      try { await initializeSupabaseSession(client); return client; }
      catch { client.release(true); throw unavailable(); }
    }).catch(() => { throw unavailable(); });
    if (callback) {
      void ready.then(client => callback(null, client, client.release.bind(client)), error => callback(error));
      return;
    }
    return ready;
  }) as Pool['connect'];
}
