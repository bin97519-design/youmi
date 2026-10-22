import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'
import {
  createCanvasPricingController,
  useCanvasPricing,
} from '../src/features/canvas-v3/composables/useCanvasPricing.js'

const input = (duration = '5') => ({
  request: { kind: 'video', model: 'model-api-key:1', params: { duration }, reference: {} },
  message: '',
})
const quote = (amount, extra = {}) => ({
  available: true,
  amount,
  unit: '米值',
  kind: 'estimate',
  ...extra,
})
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
function harness() {
  let time = 1000,
    id = 0
  const timers = new Map(),
    calls = [],
    states = []
  const controller = createCanvasPricingController({
    now: () => time,
    setTimer: (callback, delay) => {
      timers.set(++id, { at: time + delay, callback })
      return id
    },
    clearTimer: (timer) => timers.delete(timer),
    onChange: (state) => states.push(state),
    client: {
      estimate: (body, options) =>
        new Promise((resolve, reject) => calls.push({ body, ...options, resolve, reject })),
    },
  })
  return {
    controller,
    calls,
    states,
    timers,
    tick(ms) {
      time += ms
      for (const [key, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(key)
          timer.callback()
        }
    },
    now: () => time,
  }
}

test('debounce coalesces parameter edits while immediately clearing previous numbers', async () => {
  const h = harness()
  h.controller.update(input(), 'account:project:node')
  assert.equal(h.controller.state.status, 'loading')
  h.tick(299)
  assert.equal(h.calls.length, 0)
  h.controller.update(input('10'), 'account:project:node')
  h.tick(300)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].body.params.duration, '10')
  h.calls[0].resolve(quote('12'))
  await flush()
  assert.equal(h.controller.state.quote.amount, '12')
  h.controller.update(input('15'), 'account:project:node')
  assert.equal(h.controller.state.status, 'loading')
  assert.equal(h.controller.state.quote, null)
  h.controller.dispose()
})

test('aborted out-of-order replies cannot overwrite the newest model/parameter quote', async () => {
  const h = harness()
  h.controller.update(input('5'), 'scope')
  h.tick(300)
  h.controller.update(input('10'), 'scope')
  assert.equal(h.calls[0].signal.aborted, true)
  h.tick(300)
  h.calls[1].resolve(quote('20'))
  await flush()
  h.calls[0].resolve(quote('5'))
  await flush()
  assert.equal(h.controller.state.quote.amount, '20')
  h.controller.dispose()
})

test('account/project/node changes clear prices and scope caches never cross sessions', async () => {
  const h = harness()
  h.controller.update(input(), 'userA:tokenA:projectA:nodeA')
  h.tick(300)
  h.calls[0].resolve(quote('0'))
  await flush()
  h.controller.update(input(), 'userB:tokenB:projectB:nodeB')
  assert.equal(h.controller.state.quote, null)
  h.tick(300)
  assert.equal(h.calls.length, 2)
  h.calls[1].resolve(quote('30'))
  await flush()
  h.controller.update(input(), 'userA:tokenA:projectA:nodeA')
  assert.equal(h.controller.state.quote.amount, '0')
  assert.equal(h.calls.length, 2)
  h.controller.dispose()
})

test('same pricing dependencies do not refetch and expiry clears stale values before automatic revalidation', async () => {
  const h = harness()
  h.controller.update(input(), 'scope')
  h.tick(300)
  h.calls[0].resolve(quote('10', { expiresAt: h.now() + 1000 }))
  await flush()
  h.controller.update(structuredClone(input()), 'scope')
  assert.equal(h.calls.length, 1)
  h.tick(1000)
  assert.equal(h.controller.state.status, 'loading')
  assert.equal(h.controller.state.quote, null)
  h.tick(300)
  assert.equal(h.calls.length, 2)
  h.calls[1].reject(new Error('定价暂不可用'))
  await flush()
  assert.equal(h.controller.state.status, 'unavailable')
  assert.equal(h.controller.state.quote, null)
  h.controller.dispose()
})

test('local invalid metadata, logout and disposal cancel pending work without a network request', () => {
  const h = harness()
  h.controller.update(input(), 'scope')
  h.controller.update({ request: null, message: '尚未读取视频实际时长' }, 'scope')
  assert.equal(h.controller.state.status, 'unavailable')
  assert.match(h.controller.state.message, /实际时长/)
  h.tick(1000)
  assert.equal(h.calls.length, 0)
  h.controller.update(input(), 'scope', false)
  assert.equal(h.controller.state.status, 'idle')
  h.controller.update(input(), 'scope')
  h.controller.dispose()
  h.tick(1000)
  assert.equal(h.calls.length, 0)
  assert.equal(h.timers.size, 0)
})

test('Vue composable invalidates old values synchronously and disposes watchers and requests', async () => {
  const scope = effectScope(),
    request = ref(input()),
    account = ref('A'),
    enabled = ref(true)
  let calls = 0,
    pending
  const pricing = scope.run(() =>
    useCanvasPricing({
      request,
      scope: account,
      enabled,
      debounceMs: 0,
      client: {
        estimate: (_body, options) => {
          calls++
          return new Promise((resolve) => {
            pending = { resolve, signal: options.signal }
          })
        },
      },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 5))
  pending.resolve(quote('0'))
  await nextTick()
  await flush()
  assert.equal(pricing.display.value, '0.00')
  request.value = input('10')
  assert.equal(pricing.display.value, '…')
  assert.equal(pricing.quote.value, null)
  await new Promise((resolve) => setTimeout(resolve, 5))
  scope.stop()
  assert.equal(pending.signal.aborted, true)
  pending.resolve(quote('99'))
  await flush()
  assert.equal(pricing.quote.value, null)
  assert.equal(calls, 2)
})
