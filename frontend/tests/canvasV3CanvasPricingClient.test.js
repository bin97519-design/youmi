import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasPricingDisplay,
  canvasPricingTitle,
  canvasPricingWarning,
  createCanvasPricingClient,
  normalizeCanvasPricingQuote,
} from '../src/features/canvas-v3/sync/canvasPricingClient.js'

const quote = (extra = {}) => ({
  available: true,
  amount: '12.345',
  unit: '米值',
  kind: 'estimate',
  expiresAt: 40000,
  ...extra,
})

test('pricing client calls only the authenticated local estimate endpoint and never a generation endpoint', async () => {
  const calls = []
  const client = createCanvasPricingClient({
    path: (path) => '/local' + path,
    headers: () => ({ Authorization: 'Bearer local-session' }),
    fetcher: async (...args) => {
      calls.push(args)
      return { ok: true, status: 200, json: async () => ({ code: 0, data: quote() }) }
    },
  })
  const abort = new AbortController()
  const body = { kind: 'video', model: 'model-api-key:1', params: { duration: '5' }, reference: {} }
  const result = await client.estimate(body, { signal: abort.signal })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/local/api/canvas-pricing/estimate')
  assert.equal(calls[0][1].method, 'POST')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer local-session')
  assert.equal(calls[0][1].signal, abort.signal)
  assert.deepEqual(JSON.parse(calls[0][1].body), body)
  assert.equal(result.amount, '12.345')
})

test('business failures inside HTTP 200 and malformed responses fail closed and redact credential-looking messages', async () => {
  for (const [status, payload] of [
    [200, { code: 403, message: 'key sk-sensitive-token Bearer secret' }],
    [500, { message: 'upstream unavailable' }],
    [200, null],
  ]) {
    const client = createCanvasPricingClient({
      fetcher: async () => ({ ok: status < 400, status, json: async () => payload }),
    })
    await assert.rejects(client.estimate({}), (error) => {
      assert.doesNotMatch(error.message, /sk-sensitive-token|Bearer secret/)
      return true
    })
  }
})

test('zero and decimal estimates preserve exact values while display always uses two decimal places', () => {
  for (const [amount, display] of [
    ['0', '0.00'],
    ['12', '12.00'],
    ['12.3', '12.30'],
    ['12.345', '12.35'],
    ['99.995', '100.00'],
    ['900719925474099312345.001', '900719925474099312345.00'],
    [1e-7, '0.00'],
  ]) {
    const normalized = normalizeCanvasPricingQuote(quote({ amount }), 1000)
    assert.equal(normalized.available, true)
    assert.equal(canvasPricingDisplay(normalized), display)
  }
})

test('valid channel ranges and precharge quotes display both endpoints and explain conversion without multiplying again', () => {
  const normalized = normalizeCanvasPricingQuote(
    quote({
      amount: null,
      minAmount: '12.3',
      maxAmount: '18.6',
      kind: 'precharge',
      platformUnit: '算力',
      conversionMultiplier: 100,
      sourceMinAmount: '0.123',
      sourceMaxAmount: '0.186',
    }),
    1000,
  )
  assert.equal(normalized.available, true)
  assert.equal(canvasPricingDisplay(normalized), '12.30–18.60')
  assert.match(canvasPricingTitle(normalized), /预计预扣 12.30–18.60 米值/)
  assert.match(canvasPricingTitle(normalized), /×100/)
  assert.equal(normalized.minAmount, '12.3')
  assert.equal(normalized.sourceMinAmount, '0.123')
  assert.equal(
    canvasPricingDisplay(
      normalizeCanvasPricingQuote(
        quote({ amount: null, minAmount: '12.301', maxAmount: '12.304' }),
        1000,
      ),
    ),
    '12.30',
  )
})

test('unsupported units, invalid numbers, reversed ranges, expired and unavailable prices never create a visible number', () => {
  for (const payload of [
    quote({ unit: '算力' }),
    quote({ amount: '-1' }),
    quote({ amount: Infinity }),
    quote({ amount: null, minAmount: '20', maxAmount: '10' }),
    quote({ amount: null }),
    quote({ expiresAt: 999 }),
    quote({ kind: 'unknown' }),
    { available: false, message: '缺少定价规则', amount: 123 },
  ]) {
    const normalized = normalizeCanvasPricingQuote(payload, 1000)
    assert.equal(normalized.available, false)
    assert.equal(canvasPricingDisplay(normalized), '—')
  }
})

test('500 mi warning is strictly greater than 500 and distinguishes uncertain channel ranges', () => {
  for (const amount of ['0', '499.99', '500', '500.00'])
    assert.equal(canvasPricingWarning(normalizeCanvasPricingQuote(quote({ amount }), 1000)), '')
  assert.match(
    canvasPricingWarning(normalizeCanvasPricingQuote(quote({ amount: '500.01' }), 1000)),
    /预计消耗超过 500.00 米值/,
  )
  assert.equal(
    canvasPricingWarning(
      normalizeCanvasPricingQuote(
        quote({ amount: null, minAmount: '450', maxAmount: '500' }),
        1000,
      ),
    ),
    '',
  )
  assert.match(
    canvasPricingWarning(
      normalizeCanvasPricingQuote(
        quote({ amount: null, minAmount: '500', maxAmount: '550' }),
        1000,
      ),
    ),
    /可能超过/,
  )
  assert.doesNotMatch(
    canvasPricingWarning(
      normalizeCanvasPricingQuote(
        quote({ amount: null, minAmount: '500.01', maxAmount: '550' }),
        1000,
      ),
    ),
    /可能/,
  )
  assert.equal(canvasPricingWarning(null), '')
})
