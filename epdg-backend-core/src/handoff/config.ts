import { validateSyntheticEnvironment } from '../config/synthetic';
import { PortalError } from '../security/primitives';
import { HostedPracticeProfile, isHostedPractice, validateHostedPracticeEnvironment } from '../hosted-practice/profile';

export const handoffPath = '/internal/crm/onboarding-handoffs';
export const handoffKeyId = 'synthetic-local-v1';
export const handoffLock = 'epdg-synthetic-crm-handoff-v1';
export const hostedHandoffKeyId = 'synthetic-hosted-v1';
export interface HandoffConfig { key: Buffer; hosted?: HostedPracticeProfile }

/** This feature cannot be enabled for production, a remote DB, or a browser. */
export function handoffConfig(env: NodeJS.ProcessEnv = process.env): HandoffConfig {
  try {
    const hosted = isHostedPractice(env) ? validateHostedPracticeEnvironment(env) : undefined;
    if (!hosted) validateSyntheticEnvironment(env);
    if (env[hosted ? 'EPDG_HOSTED_PRACTICE_HANDOFF_ENABLED' : 'EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED'] !== '1') throw new Error('Disabled');
    const encoded = env[hosted ? 'EPDG_HOSTED_PRACTICE_HANDOFF_KEY' : 'EPDG_SYNTHETIC_CRM_HANDOFF_KEY'] ?? '';
    const key = Buffer.from(encoded, 'base64url');
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded) || key.length !== 32 || key.toString('base64url') !== encoded ||
        [env.JWT_SECRET, env.CERT_SIGNING_SECRET, env.SESSION_CSRF_SECRET, env.DB_PASSWORD].includes(encoded)) {
      throw new Error('Invalid independent handoff key');
    }
    return { key, ...(hosted ? { hosted } : {}) };
  } catch { throw new PortalError(503, 'Synthetic onboarding handoff is unavailable'); }
}

export function handoffEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[isHostedPractice(env) ? 'EPDG_HOSTED_PRACTICE_HANDOFF_ENABLED' : 'EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED'] !== '1') return false;
  const config = handoffConfig(env); config.key.fill(0); return true;
}
