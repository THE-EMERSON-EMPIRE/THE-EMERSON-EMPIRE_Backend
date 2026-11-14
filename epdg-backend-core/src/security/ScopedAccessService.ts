import type { PoolClient } from 'pg';
import { PortalError } from './primitives';
import { draftInput, permissionsForScopedRoles, requireScopedAccessEnabled, scopedUuid, type ScopeType } from './scopedAccessPolicy';
import manifest from './access-schema-manifest.json';

export interface ScopedAssignment { id: string; role_code: string; revision: string; scope_type: ScopeType; scope_id: string; organization_id: number }
export async function checkAccessSchema(client: PoolClient): Promise<void> {
  const { rows } = await client.query(`SELECT m.sha256,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,
    has_schema_privilege(current_user,'portal_access','CREATE') AS schema_create,
    (has_schema_privilege(current_user,'core','CREATE') OR has_schema_privilege(current_user,'epdg','CREATE')
      OR has_schema_privilege(current_user,'portal_security','CREATE')) AS identity_schema_create,
    has_column_privilege(current_user,'portal_security.account_states','active','UPDATE') AS activation,
    has_table_privilege(current_user,'portal_access.resources','SELECT,INSERT,UPDATE,DELETE') AS direct_resources,
    (has_table_privilege(current_user,'portal_security.role_assignments','INSERT,UPDATE,DELETE')
      OR has_any_column_privilege(current_user,'portal_security.role_assignments','INSERT,UPDATE')) AS direct_roles,
    (has_table_privilege(current_user,'core.users','INSERT,DELETE') OR has_column_privilege(current_user,'core.users','name','UPDATE')
      OR has_column_privilege(current_user,'epdg.users','role','UPDATE') OR has_table_privilege(current_user,'core.user_branch_roles','INSERT,UPDATE,DELETE')) AS direct_identity
    FROM portal_access.schema_migrations m CROSS JOIN pg_roles r WHERE m.version=$1 AND r.rolname=current_user`, [manifest.version]);
  const row = rows[0];
  if (rows.length !== 1 || row.sha256 !== manifest.sha256 || row.rolsuper || row.rolbypassrls || row.rolcreatedb || row.rolcreaterole
    || row.schema_create || row.identity_schema_create || row.activation || row.direct_resources || row.direct_roles || row.direct_identity) throw new PortalError(503, 'Scoped access schema is unavailable');
}
// All actor IDs originate from PortalService.withAuthenticatedSession, never request fields.
// The same transaction preserves account/session locks through each authorization and write.
export class ScopedAccessService {
  async snapshot(client: PoolClient, userId: number) {
    requireScopedAccessEnabled();
    const { rows } = await client.query<{ assignments: ScopedAssignment[] }>('SELECT portal_access.snapshot($1) AS assignments', [userId]);
    const assignments = rows[0]?.assignments ?? [];
    if (assignments.length > 128) throw new PortalError(403, 'Account scope requires review');
    return { assignments, permissions: permissionsForScopedRoles(assignments.map(item => item.role_code)),
      scopes: assignments.map(({ scope_type, scope_id, organization_id }) => ({ scope_type, scope_id, organization_id })) };
  }
  async assertPermission(client: PoolClient, actorId: number, permission: string, scopeType: ScopeType, scopeId: string | number): Promise<void> {
    requireScopedAccessEnabled();
    const { rows } = await client.query<{ allowed: boolean }>('SELECT portal_access.has_permission($1,$2,$3,$4) AS allowed', [actorId, permission, scopeType, String(scopeId)]);
    if (rows[0]?.allowed !== true) throw new PortalError(403, 'This action is outside your approved scope');
  }
  async listResources(client: PoolClient, actorId: number) {
    requireScopedAccessEnabled();
    const { rows } = await client.query(`SELECT id::text,organization_id,kind,group_id::text,subject_user_id,title,body,status,revision::text,
      portal_access.has_permission($1,'resource.edit','resource',id::text) AS can_edit,
      portal_access.has_permission($1,'resource.review','resource',id::text) AS can_review,
      portal_access.has_permission($1,'resource.publish','resource',id::text) AS can_publish
      FROM portal_access.read_resources($1)`, [actorId]);
    return { items: rows };
  }
  async readResource(client: PoolClient, actorId: number, id: unknown) {
    requireScopedAccessEnabled();
    const { rows } = await client.query('SELECT id::text,organization_id,kind,group_id::text,subject_user_id,title,body,status,revision::text FROM portal_access.read_resources($1,$2)', [actorId, scopedUuid(id)]);
    if (rows.length !== 1) throw new PortalError(404, 'Resource unavailable');
    return { resource: rows[0] };
  }
  async updateDraft(client: PoolClient, actorId: number, id: unknown, input: unknown) {
    const resourceId = scopedUuid(id); const { body, revision } = draftInput(input);
    await this.assertPermission(client, actorId, 'resource.edit', 'resource', resourceId);
    const { rows } = await client.query('SELECT portal_access.write_resource($1,$2,$3,$4)::text AS revision', [actorId, resourceId, revision, body]);
    return { revision: rows[0].revision };
  }
  async reviewResource(client: PoolClient, actorId: number, id: unknown, body: unknown) {
    const resourceId = scopedUuid(id);
    if (typeof body !== 'string' || !body.trim() || body.length > 4000) throw new PortalError(400, 'A bounded review is required');
    await this.assertPermission(client, actorId, 'resource.review', 'resource', resourceId);
    const { rows } = await client.query('SELECT portal_access.review_resource($1,$2,$3)::text AS id', [actorId, resourceId, body]);
    return { review: rows[0] };
  }
  async publishResource(client: PoolClient, actorId: number, id: unknown, revision: unknown) {
    const resourceId = scopedUuid(id);
    if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new PortalError(400, 'A current revision is required');
    await this.assertPermission(client, actorId, 'resource.publish', 'resource', resourceId);
    await client.query('SELECT portal_access.publish_resource($1,$2,$3)', [actorId, resourceId, revision]);
    return { published: true };
  }
}
