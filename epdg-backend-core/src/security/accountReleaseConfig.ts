import type { PoolClient } from 'pg';
import { validateSyntheticEnvironment } from '../config/synthetic';
import { portalConfig } from './config';
import { PortalError } from './primitives';

export const accountManagementEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.EPDG_ACCOUNT_MANAGEMENT_ENABLED === '1';
const reference = (value: string | undefined): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_./-]{7,119}$/.test(value);
export const plainMailbox = (value: unknown): value is string => typeof value === 'string' && value.length <= 150 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value);

export function accountReleaseConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!accountManagementEnabled(env)) throw new PortalError(503, 'Account management is unavailable pending release approval');
  if (env.EPDG_ADMIN_STAGING_MODE || env.EPDG_INVITATION_REVIEW_MODE || env.EPDG_NEON_ADMIN_STAGING_MODE || env.EPDG_HOSTED_PRACTICE_MODE) {
    throw new PortalError(503, 'Account management cannot combine runtime profiles');
  }
  const synthetic = env.EPDG_SYNTHETIC_MODE === '1';
  if (synthetic) validateSyntheticEnvironment(env);
  else if (env.NODE_ENV !== 'production' || env.DB_SSL !== 'true' || env.EPDG_ACCOUNT_PRODUCTION_APPROVED !== '1') {
    throw new PortalError(503, 'Production account release has not been approved');
  }
  const { origin } = portalConfig(env);
  if (!reference(env.EPDG_ACCOUNT_TARGET_ID) || !reference(env.EPDG_ACCOUNT_RELEASE_APPROVAL)) {
    throw new PortalError(503, 'Verified account target and approval references are required');
  }
  const deliveryEnabled = env.EPDG_INVITATION_DELIVERY_ENABLED === '1';
  const batchApproval = env.EPDG_INVITATION_BATCH_APPROVAL;
  const from = env.SMTP_FROM ?? '';
  const replyTo = env.PORTAL_MAIL_REPLY_TO ?? '';
  if (deliveryEnabled) {
    if (!reference(batchApproval) || !plainMailbox(replyTo)) throw new PortalError(503, 'Invitation sender and batch approval are incomplete');
    if (synthetic) {
      if (!replyTo.endsWith('.invalid')) throw new PortalError(503, 'Synthetic reply-to must remain isolated');
    } else if (!plainMailbox(from) || !plainMailbox(replyTo) || env.PORTAL_SENDER_VERIFIED !== '1' || env.MAIL_DELIVERY_MODE !== 'resend' || !env.RESEND_API_KEY) {
      throw new PortalError(503, 'Verified Resend sender configuration is required');
    }
  }
  return { synthetic, origin, targetId: env.EPDG_ACCOUNT_TARGET_ID, approvalRef: env.EPDG_ACCOUNT_RELEASE_APPROVAL,
    deliveryEnabled, batchApproval, from, replyTo };
}

/** Environment settings cannot authorize a release without the operator-owned DB binding. */
export async function assertAccountRelease(client: PoolClient, sending = false): Promise<void> {
  const config = accountReleaseConfig();
  const { rows } = await client.query<{allowed: boolean}>(
    'SELECT portal_accounts.release_allowed($1,$2,$3,$4) AS allowed',
    [config.targetId,config.approvalRef,sending,config.batchApproval ?? '']);
  if (rows.length !== 1 || !rows[0].allowed || (sending && !config.deliveryEnabled)) throw new PortalError(503, 'Account release is not authorized for this target');
}
