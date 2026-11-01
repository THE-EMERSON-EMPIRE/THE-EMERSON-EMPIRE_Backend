import bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { deliverEmail } from '../utils/mailDelivery';
import { logger } from '../utils/logger';
import { portalConfig } from './config';
import { credentialVersion, hashToken, opaqueToken, PortalError, validPassword, validToken } from './primitives';
import manifest from './schema-manifest.json';
import { isHostedPractice } from '../hosted-practice/profile';
import { checkHostedDatabase } from '../hosted-practice/readiness';

interface Membership { id: string; revision: string; school_id: number | null; company_id: number | null }
interface Account {
  id: number; name: string; email: string; password: string; role: string;
  revision: string; active: boolean; eligible: boolean; memberships: Membership[];
}
interface SessionRow {
  id: string; user_id: number; credential_version: string; account_revision: string;
  membership_fingerprint: string; expires_at: Date; revoked_at: Date | null; current: boolean;
}
interface Context { account: Account; session: SessionRow }
const dummyPasswordHash = bcrypt.hashSync('portal-login-non-account-placeholder', 12);

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function audit(client: PoolClient, event: string, userId: number, sessionId: string | null = null) {
  await client.query('INSERT INTO portal_security.audit_events(event,user_id,session_id) VALUES($1,$2,$3)', [event, userId, sessionId]);
}
async function account(client: PoolClient, userId: number, exclusive = false): Promise<Account | null> {
  const lock = exclusive ? 'UPDATE' : 'SHARE';
  const { rows } = await client.query<Omit<Account, 'memberships'>>(`SELECT
    cu.id,cu.name,cu.email,cu.password,ubr.role_name::text AS role,st.active,st.revision::text,
    (cu.deleted_at IS NULL AND eu.deleted_at IS NULL AND cu.is_verified AND eu.is_verified
      AND eu.rejection_reason IS NULL AND ubr.rejection_reason IS NULL
      AND CASE ubr.role_name::text
        WHEN 'intern' THEN EXISTS(SELECT 1 FROM epdg.intern_profiles p WHERE p.user_id=cu.id AND p.is_approved AND p.rejection_reason IS NULL)
        WHEN 'school' THEN EXISTS(SELECT 1 FROM epdg.schools p WHERE p.user_id=cu.id AND p.is_approved AND p.deleted_at IS NULL)
        WHEN 'company' THEN EXISTS(SELECT 1 FROM epdg.companies p WHERE p.user_id=cu.id AND p.is_approved AND p.deleted_at IS NULL)
        WHEN 'admin' THEN EXISTS(SELECT 1 FROM epdg.admins p WHERE p.user_id=cu.id AND NOT p.force_password_change)
        ELSE false END) AS eligible
    FROM portal_security.account_states st JOIN core.users cu ON cu.id=st.user_id
    JOIN epdg.users eu ON eu.id=cu.id
    JOIN core.user_branch_roles ubr ON ubr.user_id=cu.id
    JOIN core.branches b ON b.id=ubr.branch_id AND b.code='epdg'
    WHERE cu.id=$1 FOR ${lock} OF st,cu,eu,ubr`, [userId]);
  if (rows.length !== 1) return null;
  const { rows: memberships } = await client.query<Membership>(`SELECT m.id,m.revision::text,m.school_id,m.company_id
    FROM portal_security.memberships m WHERE m.user_id=$1 AND m.active
      AND ((m.school_id IS NOT NULL AND EXISTS(SELECT 1 FROM epdg.schools s WHERE s.id=m.school_id AND s.is_approved AND s.deleted_at IS NULL))
        OR (m.company_id IS NOT NULL AND EXISTS(SELECT 1 FROM epdg.companies c WHERE c.id=m.company_id AND c.is_approved AND c.deleted_at IS NULL)))
    ORDER BY m.id LIMIT 65`, [userId]);
  return { ...rows[0], memberships };
}
function usable(user: Account | null): user is Account {
  return Boolean(user && user.active && user.eligible && user.memberships.length > 0 && user.memberships.length <= 64);
}
const fingerprint = (user: Account) => hashToken(user.memberships.map(m => `${m.id}:${m.revision}`).join('|'));
function publicUser(user: Account) {
  return { id: user.id, name: user.name, email: user.email, legacy_role: user.role,
    memberships: user.memberships.map(m => ({ id: m.id, school_id: m.school_id, company_id: m.company_id })),
    permissions: [] as string[], privileged_controls_available: false };
}
async function revokeAll(client: PoolClient, userId: number, reason: 'password_reset' | 'password_changed') {
  await client.query('UPDATE portal_security.account_states SET revision=revision+1 WHERE user_id=$1', [userId]);
  await client.query('UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason=$2 WHERE user_id=$1 AND revoked_at IS NULL', [userId, reason]);
  await client.query('UPDATE portal_security.recovery_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL', [userId]);
}

export async function checkSecuritySchema(): Promise<void> {
  if (isHostedPractice()) {
    const client = await getPool().connect();
    try { await checkHostedDatabase(client); } finally { client.release(); }
    return;
  }
  const { rows } = await getPool().query(`SELECT m.sha256,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='portal_security' AND c.relkind='r' AND c.relrowsecurity) AS secured_tables,
    has_schema_privilege(current_user,'portal_security','CREATE') AS schema_create,
    has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
    has_column_privilege(current_user,'portal_security.account_states','active','UPDATE') AS account_admin,
    has_column_privilege(current_user,'portal_security.memberships','active','UPDATE') AS membership_admin,
    has_table_privilege(current_user,'portal_security.schema_migrations','UPDATE') AS ledger_admin,
    has_table_privilege(current_user,'portal_security.audit_events','UPDATE,DELETE') AS audit_admin
    FROM portal_security.schema_migrations m
    CROSS JOIN pg_roles r WHERE m.version=$1 AND r.rolname=current_user`, [manifest.version]);
  if (rows.length !== 1 || rows[0].sha256 !== manifest.sha256 || rows[0].rolsuper || rows[0].rolcreatedb || rows[0].rolcreaterole ||
      rows[0].secured_tables !== 6 || rows[0].schema_create || rows[0].database_create || rows[0].account_admin ||
      rows[0].membership_admin || rows[0].ledger_admin || rows[0].audit_admin) {
    throw new Error('Portal security schema or runtime role is not approved');
  }
}

export class PortalService {
  // Scoped feature operations run inside the same transaction and current
  // account/session validation as authentication, including revocation checks.
  async withAuthenticatedSession<T>(raw: string, work: (client: PoolClient, user: ReturnType<typeof publicUser>) => Promise<T>): Promise<T> {
    return this.withSession(raw, (client, context) => work(client, publicUser(context.account)));
  }

  private async withSession<T>(raw: string, work: (client: PoolClient, context: Context) => Promise<T>, exclusive = false): Promise<T> {
    if (!validToken(raw)) throw new PortalError(401, 'Authentication required');
    const outcome = await transaction(async client => {
      const { rows: candidates } = await client.query<{user_id: number}>('SELECT user_id FROM portal_security.sessions WHERE token_hash=$1', [hashToken(raw)]);
      if (candidates.length !== 1) return { accepted: false as const };
      const user = await account(client, candidates[0].user_id, exclusive);
      const { rows: sessions } = await client.query<SessionRow>(`SELECT *,
        (expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-($2::int*interval '1 second')) AS current
        FROM portal_security.sessions WHERE token_hash=$1 FOR UPDATE`, [hashToken(raw), portalConfig().idleSeconds]);
      const session = sessions[0];
      if (!session || session.revoked_at) return { accepted: false as const };
      if (!usable(user) || !session.current || session.account_revision !== user.revision ||
          session.credential_version !== credentialVersion(user.password) || session.membership_fingerprint !== fingerprint(user)) {
        await client.query('UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason=$2 WHERE id=$1', [session.id, session.current ? 'account_changed' : 'expired']);
        await audit(client, 'session_invalidated', session.user_id, session.id);
        return { accepted: false as const };
      }
      await client.query('UPDATE portal_security.sessions SET last_seen_at=clock_timestamp() WHERE id=$1', [session.id]);
      return { accepted: true as const, value: await work(client, { account: user, session }) };
    });
    if (!outcome.accepted) throw new PortalError(401, 'Authentication required');
    return outcome.value;
  }

  async login(email: string, password: string, previous: string | null) {
    const { rows } = await getPool().query<{id: number; password: string}>('SELECT id,password FROM core.users WHERE lower(email)=$1 LIMIT 2', [email]);
    const candidate = rows.length === 1 ? rows[0] : null;
    const matches = await bcrypt.compare(password, candidate?.password ?? dummyPasswordHash);
    if (!candidate || !matches) throw new PortalError(401, 'Invalid email or password');
    return transaction(async client => {
      const user = await account(client, candidate.id, true);
      if (!usable(user) || user.password !== candidate.password) throw new PortalError(401, 'Invalid email or password');
      if (previous && validToken(previous)) await client.query("UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='rotated' WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL", [hashToken(previous), user.id]);
      const token = opaqueToken();
      const { rows: [session] } = await client.query<{id: string; expires_at: Date}>(`INSERT INTO portal_security.sessions
        (user_id,token_hash,credential_version,account_revision,membership_fingerprint,expires_at)
        VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6::int*interval '1 second')) RETURNING id,expires_at`,
      [user.id, hashToken(token), credentialVersion(user.password), user.revision, fingerprint(user), portalConfig().absoluteSeconds]);
      await audit(client, 'login_succeeded', user.id, session.id);
      return { token, user: publicUser(user), expiresAt: session.expires_at.toISOString() };
    });
  }

  async session(raw: string) {
    return this.withSession(raw, async (_client, context) => ({ user: publicUser(context.account), expiresAt: context.session.expires_at.toISOString() }));
  }
  async logout(raw: string) {
    await this.withSession(raw, async (client, context) => {
      await client.query("UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE id=$1", [context.session.id]);
      await audit(client, 'logout', context.account.id, context.session.id);
    });
  }
  async changePassword(raw: string, currentPassword: string, newPassword: string) {
    if (!validPassword(newPassword)) throw new PortalError(400, 'Password must contain at least 12 characters and at most 72 UTF-8 bytes');
    await this.withSession(raw, async (client, context) => {
      if (!await bcrypt.compare(currentPassword, context.account.password)) throw new PortalError(400, 'Current password is incorrect');
      const hashed = await bcrypt.hash(newPassword, 12);
      await this.updatePasswords(client, context.account.id, hashed);
      await revokeAll(client, context.account.id, 'password_changed');
      await audit(client, 'password_changed', context.account.id, context.session.id);
    }, true);
  }
  private async updatePasswords(client: PoolClient, userId: number, hashed: string) {
    for (const schema of ['core', 'epdg']) {
      const result = await client.query(`UPDATE ${schema}.users SET password=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id`, [hashed, userId]);
      if (result.rowCount !== 1) throw new Error('Identity synchronization failed');
    }
  }

  async requestRecovery(email: string): Promise<void> {
    const { rows } = await getPool().query<{id: number}>('SELECT id FROM core.users WHERE lower(email)=$1 LIMIT 2', [email]);
    if (rows.length !== 1) return;
    const delivery = await transaction(async client => {
      const user = await account(client, rows[0].id, true);
      if (!usable(user)) return null;
      await client.query('UPDATE portal_security.recovery_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL', [user.id]);
      const token = opaqueToken();
      await client.query(`INSERT INTO portal_security.recovery_tokens(user_id,token_hash,credential_version,account_revision,expires_at)
        VALUES($1,$2,$3,$4,clock_timestamp()+interval '20 minutes')`, [user.id, hashToken(token), credentialVersion(user.password), user.revision]);
      await audit(client, 'recovery_requested', user.id);
      return { email: user.email, token };
    });
    if (!delivery) return;
    const link = `${portalConfig().origin}/reset-password#token=${delivery.token}`;
    // Tokens never enter logs. The hosted synthetic sink privately captures the
    // recovery message in its isolated DB; only the operator can read that sink.
    // Delivery failure is generic; the user can request another link.
    setImmediate(() => { void deliverEmail({ from: process.env.SMTP_FROM ?? '', to: delivery.email,
      subject: 'EPDG portal password recovery', html: `<p>A password reset was requested for your account.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 20 minutes. If you did not request it, ignore this message.</p>` })
      .then(result => { if (result.error) logger.error('Portal recovery delivery failed'); })
      .catch(() => logger.error('Portal recovery delivery failed')); });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!validToken(token) || !validPassword(newPassword)) throw new PortalError(400, 'Invalid recovery request');
    await transaction(async client => {
      const { rows } = await client.query<{user_id: number}>('SELECT user_id FROM portal_security.recovery_tokens WHERE token_hash=$1', [hashToken(token)]);
      if (rows.length !== 1) throw new PortalError(400, 'Invalid or expired recovery link');
      const user = await account(client, rows[0].user_id, true);
      const { rows: tokens } = await client.query<{id: string; credential_version: string; account_revision: string}>(`SELECT id,credential_version,account_revision FROM portal_security.recovery_tokens
        WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [hashToken(token)]);
      if (!usable(user) || tokens.length !== 1 || tokens[0].credential_version !== credentialVersion(user.password) || tokens[0].account_revision !== user.revision) {
        throw new PortalError(400, 'Invalid or expired recovery link');
      }
      const hashed = await bcrypt.hash(newPassword, 12);
      await this.updatePasswords(client, user.id, hashed);
      await client.query('UPDATE portal_security.recovery_tokens SET consumed_at=clock_timestamp() WHERE id=$1', [tokens[0].id]);
      await revokeAll(client, user.id, 'password_reset');
      await audit(client, 'password_reset', user.id);
    });
  }
}
