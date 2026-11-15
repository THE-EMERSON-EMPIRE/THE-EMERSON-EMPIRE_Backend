import { validateSyntheticEnvironment } from '../config/synthetic';
import { PortalError } from './primitives';

// Scope proposals are separate from assigned permissions. No entry here grants a role.
export const INVITATION_ROLE_CATALOG = [
  { code: 'participant', name: 'Intern / Participant', invitable: true, reason: null },
  { code: 'program_coordinator', name: 'Program Coordinator / Intern Lead' },
  { code: 'technical_maintainer', name: 'Technical Maintainer / Technical Lead' },
  { code: 'founder_owner', name: 'Founder / Owner' },
  { code: 'organization_admin', name: 'Organization Administrator' },
  { code: 'hr_admin', name: 'HR Administrator (CRM)' },
  { code: 'content_editor', name: 'Content Editor' },
  { code: 'sales_staff', name: 'Sales Staff' },
  { code: 'global_outreach', name: 'Global Outreach Staff' },
  { code: 'restricted_viewer', name: 'Restricted Viewer' },
].map(role => ({ invitable: false, reason: 'Requires a separately reviewed server-side scope; no permissions are granted by an invitation.', ...role }));

export function requireInvitationReview(env: NodeJS.ProcessEnv = process.env): void {
  if (env.EPDG_INVITATION_REVIEW_MODE !== '1' || env.EPDG_ADMIN_STAGING_MODE !== '1' ||
      env.NODE_ENV !== 'test' || env.EPDG_NEON_ADMIN_STAGING_MODE || env.EPDG_HOSTED_PRACTICE_MODE) {
    throw new PortalError(503, 'Invitation release is unavailable pending review');
  }
  validateSyntheticEnvironment(env);
}
