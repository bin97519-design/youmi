import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEmotionMotion,
  emotionOpacities,
  emotionSpring,
  emotionWeights,
  moodPosition,
} from '../src/features/canvas-v3/config/emotionMotion.js'

const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`)
function fixture(reduced = false) {
  let nextId = 0
  let time = 0
  const queue = new Map()
  const frames = []
  const motion = createEmotionMotion({
    initial: { x: 50, y: 50 },
    render: (p) => frames.push(p),
    requestFrame: (callback) => {
      queue.set(++nextId, callback)
      return nextId
    },
    cancelFrame: (id) => queue.delete(id),
    reducedMotion: () => reduced,
  })
  return {
    motion,
    frames,
    queue,
    tick(dt = 1000 / 60) {
      time += dt
      const callbacks = [...queue.values()]
      queue.clear()
      callbacks.forEach((fn) => fn(time))
    },
  }
}

test('every original mood is exact, intermediate positions blend at most four neighbours', () => {
  for (let i = 0; i < 25; i++) {
    const weights = emotionWeights(10 + (i % 5) * 20, 10 + Math.floor(i / 5) * 20)
    assert.equal(weights[i], 1)
    assert.equal(weights.filter(Boolean).length, 1)
  }
  for (let x = 10; x <= 90; x += 0.7)
    for (let y = 10; y <= 90; y += 0.9) {
      const weights = emotionWeights(x, y)
      near(
        weights.reduce((sum, w) => sum + w, 0),
        1,
      )
      assert.ok(weights.every((w) => w >= 0 && w <= 1))
      assert.ok(weights.filter(Boolean).length <= 4)
    }
  assert.deepEqual(moodPosition(-100, 1000), { x: 10, y: 90 })
  assert.deepEqual(moodPosition(NaN, Infinity), { x: 50, y: 50 })
})

test('blend weights stay continuous at grid boundaries and never cause a dark flash', () => {
  const before = emotionWeights(29.99999, 41)
  const after = emotionWeights(30.00001, 41)
  before.forEach((w, i) => assert.ok(Math.abs(w - after[i]) < 0.000002))
  const weights = emotionWeights(36, 43)
  const opacities = emotionOpacities(weights)
  let above = 1
  let coverage = 0
  for (let i = 24; i >= 0; i--) {
    const effective = opacities[i] * above
    near(effective, weights[i])
    coverage += effective
    above *= 1 - opacities[i]
  }
  near(coverage, 1)
  assert.ok(emotionOpacities(Array(25).fill(0)).every((n) => n === 0))
})

test('spring is frame-rate independent and a reversed target preserves live velocity', () => {
  const one = emotionSpring(10, 75, 90, 1 / 30)
  const half = emotionSpring(10, 75, 90, 1 / 60)
  const two = emotionSpring(half.value, half.velocity, 90, 1 / 60)
  near(one.value, two.value)
  near(one.velocity, two.velocity)
  const reversed = emotionSpring(one.value, one.velocity, 10, 0)
  near(reversed.value, one.value)
  near(reversed.velocity, one.velocity)
})

test('rapid retargeting uses one RAF, remains interruptible, and settles at latest choice', () => {
  const f = fixture()
  f.motion.to(90, 10)
  for (let i = 0; i < 5; i++) f.tick()
  const live = f.frames.at(-1)
  f.motion.to(10, 90)
  assert.deepEqual(f.frames.at(-1), live, 'retarget cannot jump to the previous target')
  assert.equal(f.queue.size, 1)
  for (let i = 0; i < 120; i++) f.tick()
  assert.deepEqual(f.frames.at(-1), { x: 10, y: 90 })
  assert.equal(f.queue.size, 0)
})

test('drag follows fractional pointer positions immediately, then snaps without stale work', () => {
  const f = fixture()
  f.motion.to(90, 90)
  f.tick()
  f.motion.follow(43.25, 62.5, 100)
  assert.deepEqual(f.frames.at(-1), { x: 43.25, y: 62.5 })
  assert.equal(f.queue.size, 0)
  f.motion.follow(44.5, 61.25, 116)
  f.motion.release(50, 70, 116)
  assert.deepEqual(f.frames.at(-1), { x: 44.5, y: 61.25 })
  for (let i = 0; i < 120; i++) f.tick()
  assert.deepEqual(f.frames.at(-1), { x: 50, y: 70 })
  f.motion.to(10, 10)
  f.motion.dispose()
  const length = f.frames.length
  f.tick()
  f.motion.follow(20, 20, 150)
  f.motion.to(90, 90)
  assert.equal(f.queue.size, 0)
  assert.equal(f.frames.length, length)
})

test('reduced motion changes directly and never queues a spring', () => {
  const f = fixture(true)
  f.motion.to(90, 10)
  assert.deepEqual(f.frames.at(-1), { x: 90, y: 10 })
  assert.equal(f.queue.size, 0)
})
