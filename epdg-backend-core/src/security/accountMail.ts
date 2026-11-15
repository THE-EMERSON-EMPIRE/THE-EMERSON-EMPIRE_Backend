import { deliverEmail, type EmailMessage } from '../utils/mailDelivery';
import { escapeHtml } from '../utils/emailSafety';
import { accountReleaseConfig, plainMailbox } from './accountReleaseConfig';
import { PortalError, validToken } from './primitives';

export type AccountMailTransport = (message: EmailMessage, options?: {idempotencyKey: string}) => Promise<{error: {message: string} | null; providerId?: string}>;
export async function sendAccountInvitation(email: string, token: string, attemptId: string, transport: AccountMailTransport = deliverEmail) {
  const config = accountReleaseConfig();
  if (!config.deliveryEnabled || !plainMailbox(email) || !validToken(token) || !/^[0-9a-f-]{36}$/i.test(attemptId) ||
      (config.synthetic && !email.endsWith('.invalid'))) throw new PortalError(503, 'Invitation delivery is unavailable');
  const link = `${config.origin}/accept-invitation#token=${token}`;
  const result = await transport({ from: config.synthetic ? config.from : `Emerson Professional Development Group <${config.from}>`,
    to: email, replyTo: config.replyTo, subject: 'Your EPDG portal invitation',
    html: `<h1>Emerson Professional Development Group</h1><p>Your approved portal account is ready for setup.</p><p><a href="${escapeHtml(link)}">Confirm your email and set your password</a></p><p>This one-time link expires in 24 hours. Your existing records and approved access are preserved.</p><p>If you did not expect this invitation, contact the reply-to address. Founder-led. Built by interns.</p>` },
  { idempotencyKey: `epdg-invitation/${attemptId}` });
  return { status: result.error ? 'failed' as const : 'provider_accepted' as const, providerId: result.providerId ?? null };
}
