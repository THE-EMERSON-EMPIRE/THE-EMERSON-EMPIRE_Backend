import bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { PortalService } from './PortalService';
import { accountReleaseConfig, assertAccountRelease, plainMailbox } from './accountReleaseConfig';
import { sendAccountInvitation, type AccountMailTransport } from './accountMail';
import { hashToken, opaqueToken, PortalError, validPassword, validToken } from './primitives';
import { ScopedAccessService } from './ScopedAccessService';
import { SCOPED_ROLE_CATALOG, scopedUuid } from './scopedAccessPolicy';

type Json = Record<string, unknown>;
interface Invitation extends Json { id: string; email: string; attempt_id: string; status: string; delivery_status: string }
const id = (value: unknown): number => {
  const result = typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new PortalError(400, 'A stable account identifier is required');
  return result as number;
};
const revision = (value: unknown): number => { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new PortalError(400, 'A current revision is required'); return value as number; };
export function accountDatabaseError(error: unknown): never {
  if (error instanceof PortalError) throw error;
  const code = (error as {code?: string})?.code;
  const statuses: Record<string, number> = { P0400: 400, P0403: 403, P0404: 404, P0409: 409, P0429: 429, P0503: 503, '42501': 403, '23505': 409, '23503': 409, '40001': 409, '40P01': 409 };
  if (code && statuses[code]) throw new PortalError(statuses[code], statuses[code] === 403 ? 'This action is outside your approved scope' : statuses[code] === 429 ? 'Wait before retrying this operation' : 'Account operation requires review or updated information');
  throw error;
}

export class AccountManagementService {
  constructor(private readonly sessions = new PortalService(), private readonly transport?: AccountMailTransport) {}
  private async authorized<T>(raw: string, work: (client: PoolClient, user: Awaited<ReturnType<PortalService['session']>>['user']) => Promise<T>, exclusive = false) {
    accountReleaseConfig();
    try { return await this.sessions.withAuthenticatedSession(raw, async (client, user) => { await assertAccountRelease(client); return work(client,user); }, exclusive); }
    catch (error) { accountDatabaseError(error); }
  }
  async list(raw: string, query: {q?: string; status?: string} = {}) {
    return this.authorized(raw, async (client,user) => {
      const { rows: [row] } = await client.query<{data: {plans: Json[];accounts: Json[];invitations: Json[];audit: Json[];organizations: Json[]}}>('SELECT portal_accounts.management_snapshot($1) AS data',[user.id]);
      const data = row.data;
      // Historical mirrors may retain harmless casing/spacing; display the same
      // canonical address used for ambiguity detection and authentication.
      data.accounts = data.accounts.map(item => ({...item,email:typeof item.email === 'string' ? item.email.trim().toLowerCase() : item.email}));
      const search = query.q?.toLowerCase() ?? '';
      const match = (item: Json) => (!search || `${item.name ?? ''} ${item.email ?? ''}`.toLowerCase().includes(search)) && (!query.status || item.status === query.status);
      const config = accountReleaseConfig();
      return { ...data, plans: data.plans.filter(match), accounts: data.accounts.filter(item => !search || `${item.name} ${item.email}`.toLowerCase().includes(search)),
        invitations: data.invitations.filter(match), environment: 'portal-release-candidate', capabilities: user.permissions,
        roles: SCOPED_ROLE_CATALOG.map(role => ({...role,scope_types: role.code === 'restricted_viewer' ? ['resource'] : role.code === 'founder_owner' || role.code === 'organization_admin' ? ['organization'] : role.code === 'participant' || role.code === 'intern_team_lead' ? ['self','group','resource'] : ['group','resource',...(role.code === 'hr_admin' ? ['organization'] : [])]})),
        release: { enabled: true, delivery_enabled: config.deliveryEnabled } };
    });
  }
  async propose(raw: string, input: Json) {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!plainMailbox(email) || typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 100 || !Array.isArray(input.roles)) throw new PortalError(400,'A valid name, email, and reviewed role scopes are required');
    return this.authorized(raw,async (client,user) => {
      const { rows: [row] } = await client.query('SELECT portal_accounts.propose($1,$2,$3,$4,$5::jsonb) AS plan',[user.id,id(input.organization_id),email,input.name,JSON.stringify(input.roles)]);return row;
    });
  }
  async review(raw: string, planId: string, action: 'verify_onboarding'|'approve', input: Json) {
    return this.authorized(raw,async (client,user) => {
      const { rows: [row] } = await client.query('SELECT portal_accounts.review_plan($1,$2,$3,$4,$5) AS plan',[user.id,scopedUuid(planId),revision(input.expected_revision),action,input.evidence_ref ?? null]);return row;
    });
  }
  async provision(raw: string, planId: string, expectedRevision: unknown) {
    // No shared/default password is ever assigned. Setup can occur only through the one-time invitation.
    const unusable = await bcrypt.hash(opaqueToken()+opaqueToken().slice(0,20),12);
    return this.authorized(raw,async (client,user) => {
      const { rows: [row] } = await client.query('SELECT portal_accounts.provision($1,$2,$3,$4) AS plan',[user.id,scopedUuid(planId),revision(expectedRevision),unusable]);return row;
    });
  }
  async prepare(raw: string, userId: unknown) {
    return this.authorized(raw,async (client,user) => {
      const { rows: [row] } = await client.query('SELECT portal_accounts.prepare_invitation($1,$2) AS invitation',[user.id,id(userId)]);return row;
    });
  }
  async send(raw: string, invitationId: string, resend = false) {
    const token = opaqueToken();
    const generated = await this.authorized(raw,async (client,user) => {
      await assertAccountRelease(client,true);
      const { rows: [row] } = await client.query<{data: {reused:boolean;invitation:Invitation}}>('SELECT portal_accounts.dispatch($1,$2,$3,$4) AS data',[user.id,scopedUuid(invitationId),hashToken(token),resend]);return row.data;
    });
    if (generated.reused) return generated;
    let status: 'provider_accepted'|'failed'|'unknown' = 'unknown';let providerId: string|null = null;
    try { const result = await sendAccountInvitation(generated.invitation.email,token,generated.invitation.attempt_id,this.transport);status=result.status;providerId=result.providerId; }
    catch { /* A timeout may occur after provider acceptance: never turn uncertainty into a retry or delivery claim. */ }
    await getPool().query('SELECT portal_accounts.finish_delivery($1,$2,$3,$4)',[generated.invitation.id,generated.invitation.attempt_id,status,providerId]);
    return { reused: false, invitation: {...generated.invitation,delivery_status:status,provider_id:providerId,delivered_at:null} };
  }
  async accept(token: unknown, password: unknown) {
    accountReleaseConfig();
    if (!validToken(token) || !validPassword(password)) throw new PortalError(400,'Invalid invitation or password (12 characters to 72 UTF-8 bytes required)');
    const hashed = await bcrypt.hash(password,12);const client = await getPool().connect();
    try {
      await assertAccountRelease(client);
      const { rows: [row] } = await client.query<{accepted:boolean}>('SELECT portal_accounts.accept_invitation($1,$2) AS accepted',[hashToken(token),hashed]);
      if (!row.accepted) throw new PortalError(400,'Invalid or expired invitation');
      return { accepted:true,email_confirmed:true,activated:true,sign_in_verified:false };
    } catch (error) { accountDatabaseError(error); } finally { client.release(); }
  }
  async disable(raw: string, userId: unknown, reason: unknown) {
    if (reason !== 'access_review') throw new PortalError(400,'A supported disable reason is required');
    return this.authorized(raw,async (client,user) => {
      const { rows: [row] } = await client.query('SELECT portal_accounts.disable($1,$2,$3) AS disabled',[user.id,id(userId),reason]);return row;
    });
  }
  async workspace(raw: string) {
    return this.authorized(raw,async (client,user) => {
      const access = new ScopedAccessService();const snapshot = await access.snapshot(client,user.id);const resources = await access.listResources(client,user.id);
      const { rows: [metadata] } = await client.query('SELECT portal_access.visible_organizations($1) AS organizations',[user.id]);
      return { environment:'portal-release-candidate',user:{id:user.id,name:user.name,email:user.email},...snapshot,resources:resources.items,
        organizations: metadata.organizations,
        crm_boundary:'Applicants, resumes and onboarding remain in the CRM.' };
    });
  }
  async profile(raw: string, name: unknown) {
    if (typeof name !== 'string' || name.trim().length<1 || name.length>100) throw new PortalError(400,'A bounded display name is required');
    return this.authorized(raw,async (client,user) => {
      const { rows: [row] } = await client.query('SELECT portal_accounts.update_profile($1,$2) AS profile',[user.id,name]);return {...row.profile,email:row.profile.email.trim().toLowerCase()};
    }, true);
  }
  async resource(raw: string, resourceId: string, action: 'read'|'draft'|'review'|'publish', input: Json = {}) {
    return this.authorized(raw,async (client,user) => {
      const access = new ScopedAccessService();
      if (action==='draft') return access.updateDraft(client,user.id,resourceId,{body:input.draft,revision:input.expected_revision});
      if (action==='review') return access.reviewResource(client,user.id,resourceId,input.comment);
      if (action==='publish') return access.publishResource(client,user.id,resourceId,input.expected_revision);
      const result = await access.readResource(client,user.id,resourceId);
      const { rows: [capabilities] } = await client.query("SELECT portal_access.has_permission($1,'resource.edit','resource',$2) AS can_edit,portal_access.has_permission($1,'resource.review','resource',$2) AS can_review,portal_access.has_permission($1,'resource.publish','resource',$2) AS can_publish",[user.id,resourceId]);
      return {resource:{...result.resource,...capabilities}};
    });
  }
}
