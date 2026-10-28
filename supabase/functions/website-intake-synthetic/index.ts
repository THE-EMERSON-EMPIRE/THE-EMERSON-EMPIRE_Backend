import { createIntakeHandler } from './handler.ts'
import { bodyText, check, PROJECT } from './protocol.ts'

const rpc = async (name: string, data: unknown): Promise<unknown> => {
  const base = Deno.env.get('SUPABASE_URL')
  check(base === `https://${PROJECT}.supabase.co`, 'Project mismatch', 503)
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  check(key, 'Storage unavailable', 503)
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: {
      'content-type': 'application/json',
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(data),
  })
  check(response.ok && !response.redirected, 'Storage unavailable', 503)
  return JSON.parse(await bodyText(response))
}
Deno.serve(createIntakeHandler({
  enabled: Deno.env.get('WEBSITE_INTAKE_MODE') || '',
  origin: Deno.env.get('WEBSITE_INTAKE_PREVIEW_ORIGIN') || '',
  secret: Deno.env.get('WEBSITE_INTAKE_HMAC_KEY') || '',
}, {
  capture: async (eventId, payload, payloadHash) => {
    const value = await rpc('website_intake_synthetic_capture', {
      p_event_id: eventId,
      p_payload: payload,
      p_payload_hash: payloadHash,
    })
    check(typeof value === 'string', 'Storage unavailable', 503)
    return value
  },
  exchange: (nonce, operation, events) =>
    rpc('website_intake_synthetic_exchange', {
      p_nonce: nonce,
      p_operation: operation,
      p_events: events,
    }),
}))
