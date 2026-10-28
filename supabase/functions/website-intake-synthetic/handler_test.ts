import { createIntakeHandler, type IntakeStore } from './handler.ts'
import { ENDPOINT, signedRequest, verifyResponse } from './protocol.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const origin = 'https://synthetic--emerson-crm.netlify.app'
// Fresh test-only signing material. Never an operational key or logged value.
const key = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
)
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const config = { enabled: 'synthetic-preview', origin, secret: key }
const sample = () => ({
  eventId: crypto.randomUUID(),
  synthetic: true,
  name: 'PILOT TEST Native',
  email: 'pilot-native@intake.invalid',
  workflow: 'service',
  resourceId: 'PILOT-NATIVE',
})
const request = (payload: unknown, url = `${ENDPOINT}/capture`) =>
  new Request(url, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

Deno.test('native capture returns stable receipts and 409 for changed content', async () => {
  const hashes = new Map<string, string>()
  const store: IntakeStore = {
    capture: (id, _payload, hash) => {
      const previous = hashes.get(id)
      if (previous) {
        return Promise.resolve(previous === hash ? 'duplicate' : 'collision')
      }
      hashes.set(id, hash)
      return Promise.resolve('inserted')
    },
    exchange: () => Promise.reject(new Error('Unexpected private exchange')),
  }
  const handler = createIntakeHandler(config, store)
  const payload = sample()
  const first = await handler(request(payload))
  const retry = await handler(request(payload))
  assert(first.status === 201 && retry.status === 200, 'Receipt statuses')
  assert((await first.json()).receipt === payload.eventId, 'Original receipt')
  assert(
    (await retry.json()).receipt === payload.eventId,
    'Stable retry receipt',
  )
  assert(
    (await handler(request({ ...payload, resourceId: 'PILOT-CHANGED' })))
      .status === 409,
    'Collision rejected',
  )
  assert(hashes.size === 1, 'One event stored')
})

Deno.test('native invalid/non-synthetic payloads and wrong routes never reach storage', async () => {
  let calls = 0
  const handler = createIntakeHandler(config, {
    capture: () => {
      calls++
      return Promise.resolve('inserted')
    },
    exchange: () => {
      calls++
      return Promise.resolve({ events: [] })
    },
  })
  for (
    const change of [
      { email: 'real@example.com' },
      { synthetic: false },
      { workflow: 'program' },
      { resumeUrl: 'https://resumes.invalid/private' },
    ]
  ) {
    assert(
      (await handler(request({ ...sample(), ...change }))).status === 400,
      'Invalid synthetic payload rejected',
    )
  }
  for (
    const url of [
      `${ENDPOINT}/capture?extra=1`,
      `${ENDPOINT}/capture/unexpected`,
      'http://functions:9000/unrelated/capture',
      'https://attacker.invalid/website-intake-synthetic/capture',
    ]
  ) {
    assert(
      (await handler(request(sample(), url))).status >= 400,
      'Wrong route rejected',
    )
  }
  assert(calls === 0, 'No storage calls')
})

Deno.test('native gateway routes verify the canonical signature and bind response nonce', async () => {
  let calls = 0
  const nonces = new Set<string>()
  const handler = createIntakeHandler(config, {
    capture: () => Promise.reject(new Error('Unexpected capture')),
    exchange: (nonce) => {
      calls++
      if (nonces.has(nonce)) return Promise.resolve({ error: 'replay' })
      nonces.add(nonce)
      return Promise.resolve({ events: [] })
    },
  })
  for (
    const base of [
      ENDPOINT,
      ENDPOINT.replace('/functions/v1', ''),
      'http://functions:9000/website-intake-synthetic',
      'http://edge-runtime:9000/website-intake-synthetic',
    ]
  ) {
    const canonical = await signedRequest('pull', { limit: 20 }, key)
    const runtime = new Request(`${base}/pull`, {
      method: 'POST',
      headers: canonical.headers,
      body: await canonical.clone().text(),
    })
    const response = await handler(runtime.clone())
    assert(response.status === 200, 'Runtime request verified')
    const body = await verifyResponse(canonical, response, key) as {
      events: unknown[]
    }
    assert(body.events.length === 0, 'Canonical signed response verified')
    assert(
      (await handler(runtime.clone())).status === 409,
      'Nonce replay rejected',
    )
    const tampered = new Request(runtime.url, {
      method: 'POST',
      headers: runtime.headers,
      body: '{"limit":19}',
    })
    assert(
      (await handler(tampered)).status === 401,
      'Changed signed body rejected',
    )
  }
  assert(
    calls === 8,
    'Only valid and replay-authenticated calls reached nonce storage',
  )
})
