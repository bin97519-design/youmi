import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateReferenceShotCount,
  selectReferenceFrameTimes,
  summarizeAudioLevels,
} from './referenceVideo.js'

function sample(time, value) {
  return { time, signature: new Uint8Array(16).fill(value) }
}

test('reference frame selection keeps endpoints and prioritizes visual cuts', () => {
  const samples = [
    sample(0.03, 10),
    sample(1, 12),
    sample(2, 14),
    sample(3, 230),
    sample(4, 228),
    sample(5, 226),
    sample(6, 30),
    sample(7, 32),
    sample(7.96, 33),
  ]
  const times = selectReferenceFrameTimes(samples, 8, 6)
  assert.equal(times[0], 0.03)
  assert.equal(times.at(-1), 7.96)
  assert.ok(times.includes(3))
  assert.ok(times.includes(6))
  assert.ok(times.length <= 6)
  assert.deepEqual(
    times,
    times.toSorted((left, right) => left - right),
  )
  assert.equal(estimateReferenceShotCount(samples, 8, 6), 3)
  assert.equal(
    estimateReferenceShotCount(
      samples.map((item) => sample(item.time, 20)),
      8,
      6,
    ),
    1,
  )
})

test('audio summary distinguishes silence, steady sound and visible peaks', () => {
  assert.match(summarizeAudioLevels([0, 0.001, 0.002]), /静音/)
  assert.match(summarizeAudioLevels([0.02, 0.021, 0.019, 0.02]), /变化较平稳/)
  const summary = summarizeAudioLevels([0.01, 0.012, 0.09, 0.011, 0.08, 0.01])
  assert.match(summary, /第 1、2 秒/)
  assert.match(summary, /不作为口播文字转写/)
})
