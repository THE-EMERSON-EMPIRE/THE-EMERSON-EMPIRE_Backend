import bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { deliverEmail } from '../utils/mailDelivery';
import { PortalService } from './PortalService';
import { portalConfig } from './config';
import { hashToken, opaqueToken, PortalError, validPassword, validToken } from './primitives';
import { INVITATION_ROLE_CATALOG, requireInvitationReview } from './invitationPolicy';
import manifest from './invitation-schema-manifest.json';

interface Actor { id: number; permissions: readonly string[] }
interface Invite { id: string; user_id: number; role_code: string; status: string; delivery_status: string;
  expires_at: Date; accepted_at: Date | null; email_confirmed_at: Date | null }
interface Delivery { id: string; email: string; token: string }
const publicFields = `i.id::text,i.user_id,cu.name,cu.email,i.role_code,
  CASE WHEN i.status='pending' AND i.expires_at<=clock_timestamp() THEN 'expired' ELSE i.status END AS status,
  i.delivery_status,i.expires_at,i.accepted_at,i.email_confirmed_at,
  (SELECT max(created_at) FROM portal_security.audit_events a WHERE a.user_id=i.user_id AND a.event='login_succeeded') AS last_successful_sign_in`;

export async function checkInvitationSchema(client: PoolClient): Promise<void> {
  requireInvitationReview();
  const { rows } = await client.query(`SELECT sha256 FROM portal_invitation_review.schema_migrations WHERE version=$1`, [manifest.version]);
  if (rows.length !== 1 || rows[0].sha256 !== manifest.sha256) throw new PortalError(503, 'Invitation review schema is unavailable');
}
function requireAdministrator(user: Actor): void {
  if (!user.permissions.includes('admin.users.read') || !user.permissions.includes('admin.roles.request')) {
    throw new PortalError(403, 'Administrator permission required');
  }
}
async function item(client: PoolClient, id: string) {
  const { rows } = await client.query(`SELECT ${publicFields} FROM portal_invitation_review.invitations i JOIN core.users cu ON cu.id=i.user_id WHERE i.id=$1`, [id]);
  return rows[0];
}
async function event(client: PoolClient, id: string, actor: number | null, action: string) {
  await client.query('INSERT INTO portal_invitation_review.events(invitation_id,actor_user_id,event) VALUES($1,$2,$3)', [id, actor, action]);
}

export class InvitationService {
  constructor(private readonly sessions = new PortalService(), private readonly mail = deliverEmail) {}

  async list(raw: string) {
    requireInvitationReview();
    return this.sessions.withAuthenticatedSession(raw, async (client, user) => {
      requireAdministrator(user); await checkInvitationSchema(client);
      const { rows: items } = await client.query(`SELECT ${publicFields} FROM portal_invitation_review.invitations i
        JOIN core.users cu ON cu.id=i.user_id ORDER BY i.created_at DESC,i.id LIMIT 100`);
      const { rows: eligible_users } = await client.query(`SELECT cu.id,cu.name,cu.email FROM portal_invitation_review.candidates c
        JOIN core.users cu ON cu.id=c.user_id WHERE portal_invitation_review.eligible(c.user_id)
        ORDER BY cu.id LIMIT 100`);
      return { enabled: true, items, eligible_users, roles: INVITATION_ROLE_CATALOG, production_release_available: false };
    });
  }

  async invite(raw: string, userId: unknown, roleCode: unknown, resendId?: string) {
    requireInvitationReview();
    if (!Number.isSafeInteger(userId) || (userId as number) < 1) throw new PortalError(400, 'A stable eligible user id is required');
    if (roleCode !== 'participant') throw new PortalError(403, 'This role requires a separately authorized scope');
    if (resendId && !/^[0-9a-f-]{36}$/i.test(resendId)) throw new PortalError(400, 'Invalid invitation');
    const prepared = await this.sessions.withAuthenticatedSession(raw, async (client, user) => {
      requireAdministrator(user); await checkInvitationSchema(client);
      if (user.id === userId) throw new PortalError(403, 'Self-invitation is unavailable');
      // Serialize against acceptance, disable, and concurrent issuance for this stable identity.
      await client.query('SELECT user_id FROM portal_security.account_states WHERE user_id=$1 FOR UPDATE', [userId]);
      const { rows: existing } = await client.query<Invite & { resend_ready: boolean }>(`SELECT *,created_at<clock_timestamp()-interval '60 seconds' AS resend_ready
        FROM portal_invitation_review.invitations WHERE user_id=$1 AND status IN ('pending','accepted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [userId]);
      const previous = existing[0];
      if (!resendId && previous) return { invitation: await item(client, previous.id), reused: true, delivery: null };
      if (resendId && (!previous || previous.id !== resendId || previous.status === 'accepted')) throw new PortalError(409, 'Invitation cannot be resent');
      if (resendId && previous && !previous.resend_ready) throw new PortalError(429, 'Wait before resending this invitation');
      const { rows: candidates } = await client.query<{email: string; revision: string; password: string}>(`SELECT cu.email,cu.password,st.revision::text
        FROM core.users cu JOIN portal_security.account_states st ON st.user_id=cu.id
        WHERE cu.id=$1 AND portal_invitation_review.eligible(cu.id)`, [userId]);
      if (candidates.length !== 1) throw new PortalError(409, 'Account is not approved for an invitation');
      if (previous) {
        await client.query("UPDATE portal_invitation_review.invitations SET status='revoked' WHERE id=$1", [previous.id]);
        await event(client, previous.id, user.id, 'revoked_for_resend');
      }
      const token = opaqueToken(); const candidate = candidates[0];
      const { rows: [created] } = await client.query<Invite>(`INSERT INTO portal_invitation_review.invitations
        (user_id,email,role_code,token_hash,account_revision,credential_hash,created_by_user_id,expires_at)
        VALUES($1,$2,'participant',$3,$4,$5,$6,clock_timestamp()+interval '24 hours') RETURNING *`,
      [userId,candidate.email,hashToken(token),candidate.revision,hashToken(candidate.password),user.id]);
      await event(client, created.id, user.id, 'generated');
      return { invitation: await item(client, created.id), reused: false, delivery: { id: created.id, email: candidate.email, token } as Delivery };
    });
    if (!prepared.delivery) return { invitation: prepared.invitation, reused: prepared.reused };
    // Commit generation before sending. A crash leaves 'sending' for explicit review/resend;
    // retrying the same create operation never sends a second email.
    const delivery = prepared.delivery;
    const link = `${portalConfig().origin}/accept-invitation#token=${delivery.token}`;
    let sent = false;
    try {
      const result = await this.mail({ from: process.env.SMTP_FROM ?? '', to: delivery.email,
        subject: 'EPDG portal invitation', html: `<p>Your reviewed EPDG learning account is ready.</p><p><a href="${link}">Confirm your email and set your password</a></p><p>This invitation expires in 24 hours. Existing roles and learning records are preserved.</p>` });
      sent = !result.error;
    } catch { /* Private provider details and tokens never enter logs or public errors. */ }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE portal_invitation_review.invitations SET delivery_status=$2 WHERE id=$1 AND delivery_status='sending'", [delivery.id, sent ? 'sent' : 'failed']);
      await event(client, delivery.id, null, sent ? 'delivery_sent' : 'delivery_failed');
      const invitation = await item(client, delivery.id); await client.query('COMMIT');
      return { invitation, reused: false };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async resend(raw: string, id: string) {
    requireInvitationReview();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PortalError(400, 'Invalid invitation');
    const target = await this.sessions.withAuthenticatedSession(raw, async (client, user) => {
      requireAdministrator(user); await checkInvitationSchema(client);
      const { rows } = await client.query<{user_id: number; role_code: string}>('SELECT user_id,role_code FROM portal_invitation_review.invitations WHERE id=$1', [id]);
      if (rows.length !== 1) throw new PortalError(404, 'Invitation not found');
      return rows[0];
    });
    return this.invite(raw, target.user_id, target.role_code, id);
  }

  async accept(token: unknown, password: unknown): Promise<void> {
    requireInvitationReview();
    if (typeof token !== 'string' || !validToken(token) || typeof password !== 'string' || !validPassword(password)) {
      throw new PortalError(400, 'Invalid invitation or password (12 characters to 72 UTF-8 bytes required)');
    }
    const hashed = await bcrypt.hash(password, 12);
    const client = await getPool().connect();
    try {
      await checkInvitationSchema(client);
      const { rows: [result] } = await client.query<{accepted: boolean}>('SELECT portal_invitation_review.accept($1,$2) AS accepted', [hashToken(token), hashed]);
      if (!result?.accepted) throw new PortalError(400, 'Invalid or expired invitation');
    } finally { client.release(); }
  }
}
