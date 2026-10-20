import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createCharacterWheelNavigator,
  createCharacterDragNavigator,
  stepCharacterSpring,
} from '../src/features/canvas-v3/config/characterStudioCarousel.js'

const wheel = (deltaY, extras = {}) => ({ deltaX: 0, deltaY, deltaMode: 0, ...extras })

test('wheel navigation preserves modified, invalid and horizontally dominant native gestures', () => {
  const navigator = createCharacterWheelNavigator()
  for (const event of [
    null,
    {},
    wheel(0),
    wheel(NaN),
    wheel(Infinity),
    wheel(100, { deltaX: Infinity }),
    wheel(100, { ctrlKey: true }),
    wheel(-100, { metaKey: true }),
    wheel(50, { deltaX: 51 }),
    wheel(-50, { deltaX: -51 }),
  ])
    assert.equal(navigator.consume(event, 0), 0)
  assert.equal(navigator.consume(wheel(50), NaN), 0)
  assert.equal(navigator.consume(wheel(50), Infinity), 0)
  assert.equal(navigator.consume(wheel(50)), 0)
  assert.equal(navigator.consume(wheel(28), 0), 1, 'ignored events do not contaminate state')
})

test('pixel deltas accumulate small trackpad movements and never retain a multi-item backlog', () => {
  const navigator = createCharacterWheelNavigator()
  assert.equal(navigator.consume(wheel(7), 0), 0)
  assert.equal(navigator.consume(wheel(7), 10), 0)
  assert.equal(navigator.consume(wheel(7), 20), 0)
  assert.equal(navigator.consume(wheel(7), 30), 1)
  assert.equal(navigator.consume(wheel(200000), 40), 0)
  assert.equal(navigator.consume(wheel(0), 250), 0)
  assert.equal(navigator.consume(wheel(2), 260), 0)
})

test('line and page delta modes normalize without DOM measurements', () => {
  const line = createCharacterWheelNavigator()
  assert.equal(line.consume(wheel(1, { deltaMode: 1 }), 0), 0)
  assert.equal(line.consume(wheel(1, { deltaMode: 1 }), 10), 1)
  const page = createCharacterWheelNavigator()
  assert.equal(page.consume(wheel(-1, { deltaMode: 2 }), 0), -1)
  const pixel = createCharacterWheelNavigator()
  assert.equal(pixel.consume(wheel(1), 0), 0)
  const extreme = createCharacterWheelNavigator()
  assert.equal(extreme.consume(wheel(Number.MAX_VALUE, { deltaMode: 2 }), 0), 1)
})

test('a sustained deliberate wheel input has a 160 ms per-item cooldown', () => {
  const navigator = createCharacterWheelNavigator()
  assert.equal(navigator.consume(wheel(120), 0), 1)
  assert.equal(navigator.consume(wheel(120), 40), 0)
  assert.equal(navigator.consume(wheel(120), 80), 0)
  assert.equal(navigator.consume(wheel(120), 120), 0)
  assert.equal(navigator.consume(wheel(120), 159), 0)
  assert.equal(navigator.consume(wheel(120), 160), 1)
  assert.equal(navigator.consume(wheel(120), 240), 0)
  assert.equal(navigator.consume(wheel(120), 320), 1)
})

test('decaying inertia cannot retrigger after cooldown even when its total delta exceeds the threshold', () => {
  const navigator = createCharacterWheelNavigator()
  assert.equal(navigator.consume(wheel(100), 0), 1)
  for (const [index, delta] of [80, 60, 45, 30, 22, 18, 15, 13, 11, 9, 7, 5].entries())
    assert.equal(navigator.consume(wheel(delta), (index + 1) * 30), 0)
  assert.equal(navigator.consume(wheel(100), 400), 1, 'a strong new impulse is actionable')
})

test('low-amplitude trackpad inertia remains suppressed through a long decreasing tail', () => {
  const navigator = createCharacterWheelNavigator()
  assert.equal(navigator.consume(wheel(14), 0), 0)
  assert.equal(navigator.consume(wheel(14), 16), 1)
  for (const [index, delta] of [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].entries())
    assert.equal(navigator.consume(wheel(delta), 32 + index * 20), 0)
})

test('a reversal clears accumulated direction and bypasses the previous directional cooldown', () => {
  const navigator = createCharacterWheelNavigator()
  assert.equal(navigator.consume(wheel(28), 0), 1)
  assert.equal(navigator.consume(wheel(-28), 10), -1)
  assert.equal(navigator.consume(wheel(28), 20), 1)
  assert.equal(navigator.consume(wheel(-10), 30), 0)
  assert.equal(navigator.consume(wheel(-10), 40), 0)
  assert.equal(navigator.consume(wheel(-8), 50), -1)
})

test('quiet gaps, explicit reset and backward timestamps start independent gestures', () => {
  const navigator = createCharacterWheelNavigator()
  assert.equal(navigator.consume(wheel(20), 0), 0)
  assert.equal(navigator.consume(wheel(20), 180), 0, 'old sub-threshold delta expires')
  assert.equal(navigator.consume(wheel(8), 190), 1)
  navigator.reset()
  assert.equal(navigator.consume(wheel(28), 191), 1)
  assert.equal(navigator.consume(wheel(28), 100), 1, 'a replaced time origin cannot lock input')
})

test('spring converges monotonically without overshoot and settles exactly on the requested index', () => {
  for (const target of [-2, 1, 8]) {
    let state = { position: 0, velocity: 0 }
    let previousDistance = Math.abs(target)
    for (let frame = 0; frame < 120; frame++) {
      const next = stepCharacterSpring(state, target, 1 / 60)
      const distance = Math.abs(target - next.position)
      assert.ok(distance <= previousDistance + 1e-12)
      assert.ok(next.position >= Math.min(0, target) && next.position <= Math.max(0, target))
      previousDistance = distance
      state = next
      if (next.settled) break
    }
    assert.equal(state.position, target)
    assert.equal(state.velocity, 0)
    assert.equal(state.settled, true)
  }
})

test('spring response covers approximately 98 percent of a one-item movement within 0.3 seconds', () => {
  let state = { position: 0, velocity: 0 }
  for (let frame = 0; frame < 18; frame++) state = stepCharacterSpring(state, 1, 1 / 60)
  assert.ok(state.position >= 0.98 && state.position < 1)
})

test('retargeting preserves motion continuity and does not jump to the new index', () => {
  let state = { position: 0, velocity: 0 }
  for (let frame = 0; frame < 4; frame++) state = stepCharacterSpring(state, 1, 1 / 60)
  const prior = { ...state }
  const reversed = stepCharacterSpring(state, -1, 1 / 60)
  assert.ok(Math.abs(reversed.position - prior.position) < 0.25)
  assert.notEqual(reversed.position, -1)
  assert.deepEqual(state, prior, 'stepping never mutates the prior state')
  let next = reversed
  for (let frame = 0; frame < 120 && !next.settled; frame++)
    next = stepCharacterSpring(next, -1, 1 / 60)
  assert.equal(next.position, -1)
  assert.equal(next.velocity, 0)
})

test('spring clamps long frame times, does not advance invalid time, and limits high-velocity crossings', () => {
  const state = { position: 0, velocity: 0 }
  assert.deepEqual(stepCharacterSpring(state, 1, 10), stepCharacterSpring(state, 1, 1 / 30))
  assert.deepEqual(stepCharacterSpring(state, 1, -1), { ...state, settled: false })
  assert.deepEqual(stepCharacterSpring(state, 1, NaN), { ...state, settled: false })
  assert.deepEqual(stepCharacterSpring(state, 1, 0), { ...state, settled: false })
  assert.deepEqual(stepCharacterSpring({ position: 0, velocity: 10000 }, 1, 1 / 60), {
    position: 1,
    velocity: 0,
    settled: true,
  })
  assert.deepEqual(stepCharacterSpring({ position: 2, velocity: -10000 }, 1, 1 / 60), {
    position: 1,
    velocity: 0,
    settled: true,
  })
})

test('spring returns finite robust states for absent, non-finite and pathological finite numbers', () => {
  for (const state of [
    undefined,
    null,
    {},
    { position: NaN, velocity: Infinity },
    { position: Number.MAX_VALUE, velocity: -Number.MAX_VALUE },
  ])
    for (const target of [undefined, NaN, Infinity, -Number.MAX_VALUE, 2]) {
      const next = stepCharacterSpring(state, target, 1 / 60)
      assert.ok(Number.isFinite(next.position))
      assert.ok(Number.isFinite(next.velocity))
      assert.equal(typeof next.settled, 'boolean')
    }
  assert.deepEqual(stepCharacterSpring({ position: 2, velocity: 0 }, 2, 1 / 60), {
    position: 2,
    velocity: 0,
    settled: true,
  })
})

const dragStart = (overrides = {}) => ({
  pointerId: 7,
  x: 300,
  y: 200,
  position: 2,
  step: 245,
  max: 5,
  now: 0,
  ...overrides,
})
const dragPoint = (x, now, overrides = {}) => ({ pointerId: 7, x, y: 200, now, ...overrides })

test('drag starts only with valid finite geometry and isolates its active pointer', () => {
  const navigator = createCharacterDragNavigator()
  for (const invalid of [
    null,
    {},
    dragStart({ pointerId: NaN }),
    dragStart({ x: Infinity }),
    dragStart({ y: NaN }),
    dragStart({ position: Infinity }),
    dragStart({ step: 0 }),
    dragStart({ step: -1 }),
    dragStart({ max: -1 }),
    dragStart({ now: NaN }),
  ])
    assert.equal(navigator.start(invalid), false)
  assert.equal(navigator.start(dragStart()), true)
  assert.equal(navigator.start(dragStart({ pointerId: 8 })), false)
  assert.equal(navigator.move(dragPoint(100, 10, { pointerId: 8 })), null)
  assert.equal(navigator.end({ pointerId: 8, now: 12 }), null)
  assert.equal(navigator.move(dragPoint(NaN, 15)), null)
  assert.equal(navigator.end({ pointerId: 7, now: Infinity }), null)
  assert.equal(navigator.move(dragPoint(55, 20)).position, 3)
  assert.equal(navigator.end({ pointerId: 7, now: 22 }).dragged, true)
  assert.equal(navigator.end({ pointerId: 7, now: 25 }), null)
})

test('plain taps and sub-threshold jitter never become drags or change the presentation', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart())
  assert.equal(navigator.move(dragPoint(305, 5, { y: 205 })), null)
  assert.deepEqual(navigator.end({ pointerId: 7, now: 15 }), {
    index: 2,
    position: 2,
    velocity: 0,
    dragged: false,
  })
})

test('horizontal drag follows the exact injected desktop or mobile step after hysteresis', () => {
  for (const step of [245, 210]) {
    const navigator = createCharacterDragNavigator()
    navigator.start(dragStart({ step }))
    const activated = navigator.move(dragPoint(294, 10))
    assert.equal(activated.dragged, true)
    assert.equal(activated.position, 2 + 6 / step)
    assert.equal(navigator.move(dragPoint(300 - step, 20)).position, 3)
    assert.equal(navigator.move(dragPoint(300 + step, 30)).position, 1)
  }
})

test('returning to the starting point retains drag identity to suppress click and double-click', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart())
  assert.equal(navigator.move(dragPoint(250, 20)).dragged, true)
  assert.equal(navigator.move(dragPoint(300, 40)).position, 2)
  assert.equal(navigator.end({ pointerId: 7, now: 200 }).dragged, true)
})

test('vertical intent wins before horizontal activation and cannot later be hijacked back', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart())
  assert.deepEqual(navigator.move(dragPoint(303, 5, { y: 208 })), {
    position: 2,
    velocity: 0,
    dragged: false,
    cancelled: true,
  })
  assert.equal(navigator.move(dragPoint(50, 15, { y: 210 })), null)
  assert.deepEqual(navigator.end({ pointerId: 7, now: 20 }), {
    index: 2,
    position: 2,
    velocity: 0,
    dragged: false,
  })
  navigator.start(dragStart())
  navigator.move(dragPoint(290, 10))
  assert.equal(
    navigator.move(dragPoint(280, 20, { y: 280 })).dragged,
    true,
    'an already claimed horizontal drag remains horizontal',
  )
})

test('both edges apply bounded soft resistance rather than freezing or allowing unlimited travel', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart({ position: 0 }))
  const left = navigator.move(dragPoint(545, 10))
  assert.ok(left.position < 0 && left.position > -0.2)
  const fartherLeft = navigator.move(dragPoint(30000, 20))
  assert.ok(fartherLeft.position < left.position && fartherLeft.position > -0.2)
  assert.equal(navigator.end({ pointerId: 7, now: 150 }).index, 0)
  navigator.start(dragStart({ position: 5 }))
  const right = navigator.move(dragPoint(55, 10))
  assert.ok(right.position > 5 && right.position < 5.2)
  assert.equal(navigator.end({ pointerId: 7, now: 150 }).index, 5)
})

test('grabbing a still-settling edge begins from the presented position without jumping to zero', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart({ position: -0.1 }))
  const moved = navigator.move(dragPoint(306, 10))
  assert.ok(moved.position < -0.1 && moved.position > -0.12)
})

test('recent item-per-second velocity drives a bounded one-item release projection', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart())
  const moved = navigator.move(dragPoint(202, 40))
  assert.ok(Math.abs(moved.position - 2.4) < 1e-12)
  assert.ok(Math.abs(moved.velocity - 10) < 1e-12)
  const released = navigator.end({ pointerId: 7, now: 45 })
  assert.equal(released.index, 3, 'fast motion adds at most one projected item before rounding')
  assert.equal(released.velocity, moved.velocity)
  assert.equal(released.position, moved.position)
  assert.equal(navigator.start(dragStart({ position: 4 })), true)
  navigator.move(dragPoint(150, 1))
  assert.equal(
    navigator.end({ pointerId: 7, now: 2 }).index,
    5,
    'projection is also bounded by the library end',
  )
})

test('velocity ignores samples older than 80 ms and releases held still for over 100 ms without inertia', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart())
  navigator.move(dragPoint(202, 40))
  assert.equal(navigator.move(dragPoint(202, 150)).velocity, 0)
  assert.deepEqual(navigator.end({ pointerId: 7, now: 155 }), {
    index: 2,
    position: 2.4,
    velocity: 0,
    dragged: true,
  })
  navigator.start(dragStart())
  navigator.move(dragPoint(202, 40))
  const held = navigator.end({ pointerId: 7, now: 141 })
  assert.equal(held.velocity, 0)
  assert.equal(held.index, 2)
})

test('pointer cancellation settles the actual drag location without momentum and reset forgets capture state', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart())
  navigator.move(dragPoint(202, 40))
  const cancelled = navigator.end({ pointerId: 7, now: 45, cancelled: true })
  assert.equal(cancelled.index, 2)
  assert.equal(cancelled.velocity, 0)
  assert.equal(cancelled.dragged, true)
  navigator.start(dragStart())
  navigator.reset()
  assert.equal(navigator.move(dragPoint(100, 10)), null)
  assert.equal(navigator.end({ pointerId: 7, now: 20 }), null)
})

test('drag rejects overflow deltas and keeps same-timestamp and backward-clock velocities finite', () => {
  const navigator = createCharacterDragNavigator()
  navigator.start(dragStart({ x: -Number.MAX_VALUE }))
  assert.equal(navigator.move(dragPoint(Number.MAX_VALUE, 20)), null)
  navigator.reset()
  navigator.start(dragStart())
  assert.ok(Number.isFinite(navigator.move(dragPoint(202, 0)).velocity))
  assert.equal(navigator.move(dragPoint(180, -1)).velocity, 0)
  const final = navigator.end({ pointerId: 7, now: -2 })
  assert.equal(final.velocity, 0)
  assert.ok(Number.isFinite(final.position))
  assert.ok(Number.isInteger(final.index))
})
