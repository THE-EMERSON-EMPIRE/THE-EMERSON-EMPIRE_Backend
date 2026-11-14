import { PortalError } from './primitives';

const self = ['account.self.read', 'account.self.update', 'profile.self.write'];
const accounts = ['admin.accounts.read', 'admin.accounts.prepare', 'admin.accounts.provision', 'admin.accounts.send', 'admin.invitations.send', 'admin.accounts.disable', 'admin.accounts.audit', 'admin.audit.read', 'onboarding.verify'];
const resources = ['resource.read', 'resource.edit', 'resource.review'];
// Navigation hints only. SQL checks the actual resource/category/organization on every request.
export const SCOPED_ROLE_CATALOG = [
  { code: 'founder_owner', name: 'Founder / Owner', permissions: [...self, ...accounts, ...resources, 'resource.publish', 'role.grant', 'admin.accounts.approve', 'admin.accounts.manage_staff', 'program.coordinate', 'technical.diagnostics','learning.review','learning.enroll','learning.curriculum'] },
  { code: 'organization_admin', name: 'Organization Administrator', permissions: [...self, ...accounts, ...resources, 'resource.publish', 'admin.accounts.manage_staff', 'program.coordinate','learning.review','learning.enroll','learning.curriculum'] },
  { code: 'hr_admin', name: 'HR Administrator', permissions: [...self, ...accounts, ...resources] },
  { code: 'technical_maintainer', name: 'Technical Maintainer', permissions: [...self, 'resource.read', 'resource.edit', 'technical.diagnostics'] },
  { code: 'program_coordinator', name: 'Program Coordinator', permissions: [...self, ...resources, 'program.coordinate','learning.review','learning.enroll','learning.curriculum'] },
  { code: 'intern_team_lead', name: 'Intern Team Lead', permissions: [...self, ...resources, 'program.coordinate','learning.review','learning.participate'] },
  { code: 'content_editor', name: 'Content Editor', permissions: [...self, ...resources,'learning.curriculum'] },
  { code: 'sales_staff', name: 'Sales Staff', permissions: [...self, ...resources] },
  { code: 'global_outreach', name: 'Global Outreach Staff', permissions: [...self, ...resources] },
  { code: 'restricted_viewer', name: 'Restricted Viewer', permissions: [...self, 'resource.read'] },
  { code: 'participant', name: 'Intern / Participant', permissions: [...self, 'resource.read', 'resource.edit','learning.participate'] },
] as const;
export type ScopedRoleCode = typeof SCOPED_ROLE_CATALOG[number]['code'];
export type ScopeType = 'organization' | 'group' | 'resource' | 'self' | 'user';
export function permissionsForScopedRoles(roles: readonly string[]): string[] {
  return [...new Set(SCOPED_ROLE_CATALOG.filter(role => roles.includes(role.code)).flatMap(role => [...role.permissions]))].sort();
}
export function requireScopedAccessEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (env.EPDG_ACCOUNT_MANAGEMENT_ENABLED !== '1') throw new PortalError(503, 'Account management is unavailable');
}
export function scopedUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new PortalError(400, 'A valid resource identifier is required');
  }
  return value;
}
export function draftInput(input: unknown): { body: string; revision: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PortalError(400, 'Invalid resource change');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => key !== 'body' && key !== 'revision') || typeof data.body !== 'string' || Buffer.byteLength(data.body) > 16384
    || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1) throw new PortalError(400, 'Invalid resource change');
  return { body: data.body, revision: data.revision as number };
}
