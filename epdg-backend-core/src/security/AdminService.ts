import type { PoolClient } from 'pg';
import { ADMIN_ROLE_CATALOG, hasAdminPermission, type AdminPermission } from './adminPolicy';
import { PortalError } from './primitives';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  permissions: readonly string[];
}

function requirePermission(user: AdminUser, permission: AdminPermission): void {
  if (!hasAdminPermission(user, permission)) throw new PortalError(403, 'Administrator permission required');
}

const syntheticUsers = `
  cu.email LIKE '%@epdg.invalid'
  AND cu.name LIKE 'SYNTHETIC %'
  AND cu.deleted_at IS NULL
`;

export class AdminService {
  async overview(client: PoolClient, user: AdminUser) {
    requirePermission(user, 'admin.overview.read');
    const { rows: [accounts] } = await client.query<{ total: number; active: number; inactive: number }>(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE state.active)::int AS active,
        count(*) FILTER (WHERE NOT state.active)::int AS inactive
      FROM portal_security.account_states state
      JOIN core.users cu ON cu.id=state.user_id
      JOIN epdg.users eu ON eu.id=cu.id
      JOIN core.user_branch_roles ubr ON ubr.user_id=cu.id
      JOIN core.branches branch ON branch.id=ubr.branch_id AND branch.code='epdg'
      WHERE ${syntheticUsers} AND eu.deleted_at IS NULL`);
    const { rows: [roleCounts] } = await client.query<{ pending: number; active: number }>(`
      SELECT count(*) FILTER (WHERE role.status='pending')::int AS pending,
        count(*) FILTER (WHERE role.status='active')::int AS active
      FROM portal_security.role_assignments role
      JOIN core.users cu ON cu.id=role.user_id
      WHERE ${syntheticUsers}`);
    const { rows: [audit] } = await client.query<{ recent: number }>(`
      SELECT count(*)::int AS recent FROM portal_security.admin_events
      WHERE created_at >= clock_timestamp() - interval '30 days'`);
    return {
      environment: 'isolated-synthetic',
      accounts,
      role_assignments: roleCounts,
      audit_events_30d: audit.recent,
    };
  }

  async users(client: PoolClient, user: AdminUser) {
    requirePermission(user, 'admin.users.read');
    const { rows } = await client.query(`
      SELECT cu.id,cu.name,cu.email,ubr.role_name::text AS legacy_role,state.active,
        COALESCE(array_agg(DISTINCT role.role_code) FILTER (WHERE role.status='active'),ARRAY[]::text[]) AS portal_roles,
        count(DISTINCT role.id) FILTER (WHERE role.status='pending')::int AS pending_role_requests
      FROM portal_security.account_states state
      JOIN core.users cu ON cu.id=state.user_id
      JOIN epdg.users eu ON eu.id=cu.id
      JOIN core.user_branch_roles ubr ON ubr.user_id=cu.id
      JOIN core.branches branch ON branch.id=ubr.branch_id AND branch.code='epdg'
      LEFT JOIN portal_security.role_assignments role ON role.user_id=cu.id
      WHERE ${syntheticUsers} AND eu.deleted_at IS NULL AND cu.is_verified AND eu.is_verified
      GROUP BY cu.id,cu.name,cu.email,ubr.role_name,state.active
      ORDER BY lower(cu.email),cu.id LIMIT 100`);
    return { items: rows };
  }

  async roles(client: PoolClient, user: AdminUser) {
    requirePermission(user, 'admin.roles.read');
    const { rows } = await client.query(`
      SELECT role.id::text,role.user_id,cu.name,cu.email,role.role_code,role.status,
        role.created_at,role.revision::text
      FROM portal_security.role_assignments role
      JOIN core.users cu ON cu.id=role.user_id
      WHERE ${syntheticUsers}
      ORDER BY role.created_at DESC,role.id LIMIT 100`);
    return {
      catalog: ADMIN_ROLE_CATALOG,
      assignments: rows,
      hr_boundary: 'Applicant and onboarding records are managed in the Emerson CRM, not EPDG.',
    };
  }

  async requestWebDevRole(client: PoolClient, user: AdminUser, targetUserId: unknown, roleCode: unknown) {
    requirePermission(user, 'admin.roles.request');
    if (!Number.isSafeInteger(targetUserId) || (targetUserId as number) < 1) {
      throw new PortalError(400, 'A valid synthetic user id is required');
    }
    if (roleCode !== 'webdev_technical') {
      throw new PortalError(403, 'This role cannot be requested from EPDG staging');
    }
    if (targetUserId === user.id) throw new PortalError(403, 'Self-assignment is unavailable');

    const { rows: targets } = await client.query(`
      SELECT cu.id FROM portal_security.account_states state
      JOIN core.users cu ON cu.id=state.user_id
      JOIN epdg.users eu ON eu.id=cu.id
      JOIN core.user_branch_roles ubr ON ubr.user_id=cu.id
      JOIN core.branches branch ON branch.id=ubr.branch_id AND branch.code='epdg'
      WHERE cu.id=$1 AND state.active AND cu.is_verified AND eu.is_verified
        AND cu.deleted_at IS NULL AND eu.deleted_at IS NULL
        AND eu.rejection_reason IS NULL AND ubr.rejection_reason IS NULL
        AND ${syntheticUsers}
      FOR UPDATE OF state`, [targetUserId]);
    if (targets.length !== 1) throw new PortalError(404, 'Active synthetic EPDG account not found');

    const { rows: existing } = await client.query(`
      SELECT id FROM portal_security.role_assignments
      WHERE user_id=$1 AND role_code='webdev_technical' AND status IN ('pending','active') LIMIT 1`, [targetUserId]);
    if (existing.length) throw new PortalError(409, 'A WebDev role request already exists');

    const { rows: [assignment] } = await client.query(`
      INSERT INTO portal_security.role_assignments(user_id,role_code,status,assigned_by_user_id)
      VALUES($1,'webdev_technical','pending',$2)
      RETURNING id::text,status,created_at`, [targetUserId,user.id]);
    await client.query(`INSERT INTO portal_security.admin_events(event,actor_user_id,target_user_id,role_code)
      VALUES('role_assignment_requested',$1,$2,'webdev_technical')`, [user.id,targetUserId]);
    return { assignment, permissions_granted: false };
  }

  educationReadiness(user: AdminUser) {
    requirePermission(user, 'admin.overview.read');
    return {
      programs: { status: 'awaiting-approved-education-schema', writable: false },
      cohorts: { status: 'awaiting-approved-education-schema', writable: false },
      assignments: { status: 'awaiting-approved-education-schema', writable: false },
      crm: { owner: 'Emerson CRM', learner_activation: false },
    };
  }
}
