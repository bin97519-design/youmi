import test from 'node:test'
import assert from 'node:assert/strict'
import {
  exportTimeline,
  reorderExportClips,
  moveExportClip,
  exportClipRange,
  exportTime,
} from '../src/utils/productVideoExport.js'

const clip = (id, extra = {}) => ({
  id,
  title: id,
  kept: true,
  duration: 4,
  start: 0,
  videoId: id,
  videos: [{ id, url: `https://example.test/${id}.mp4`, duration: 15 }],
  ...extra,
})

test('export timeline uses retained playable clips and exact fractional durations', () => {
  const shots = [
    clip('a', { duration: 3.5 }),
    clip('hidden', { kept: false }),
    clip('missing', { videoId: '' }),
    clip('b', { duration: 4.2 }),
  ]
  assert.deepEqual(
    exportTimeline(shots).map(({ shot, start, end }) => [shot.id, start, end]),
    [
      ['a', 0, 3.5],
      ['b', 3.5, 7.7],
    ],
  )
})

test('invalid timing does not produce NaN or backwards timeline blocks', () => {
  assert.deepEqual(
    exportTimeline([clip('a', { duration: NaN }), clip('b', { duration: -2 })]).map(
      ({ duration }) => duration,
    ),
    [0, 0],
  )
})

test('reordering kept clips preserves hidden slots and original media objects', () => {
  const shots = [clip('a'), clip('hidden', { kept: false }), clip('b'), clip('c')]
  const ordered = reorderExportClips(shots, ['c', 'a', 'b'])
  assert.deepEqual(
    ordered.map(({ id }) => id),
    ['c', 'hidden', 'a', 'b'],
  )
  assert.equal(ordered[0], shots[3])
  assert.deepEqual(
    shots.map(({ id }) => id),
    ['a', 'hidden', 'b', 'c'],
  )
  for (const invalid of [['a'], ['a', 'a', 'b'], ['a', 'b', 'unknown']])
    assert.equal(reorderExportClips(shots, invalid), shots)
})

test('dragging handles both insertion directions and ignores foreign IDs', () => {
  const shots = [clip('a'), clip('b'), clip('c')]
  assert.deepEqual(
    moveExportClip(shots, 'a', 'c', true).map(({ id }) => id),
    ['b', 'c', 'a'],
  )
  assert.deepEqual(
    moveExportClip(shots, 'c', 'a').map(({ id }) => id),
    ['c', 'a', 'b'],
  )
  assert.equal(moveExportClip(shots, 'foreign', 'a'), shots)
})

test('clip preview follows trim or whole-source speed exactly', () => {
  assert.deepEqual(exportClipRange(clip('a', { start: 2, duration: 4 })), {
    url: 'https://example.test/a.mp4',
    start: 2,
    end: 6,
    playbackRate: 1,
    previewSupported: true,
  })
  assert.deepEqual(exportClipRange(clip('a', { timingMode: 'speed', start: 12, duration: 3 })), {
    url: 'https://example.test/a.mp4',
    start: 0,
    end: 15,
    playbackRate: 5,
    previewSupported: true,
  })
  assert.equal(exportClipRange(clip('a', { duration: 20 })), null)
  assert.equal(exportClipRange(clip('a', { start: 14, duration: 2 })), null)
  assert.equal(
    exportClipRange(clip('a', { timingMode: 'speed', duration: 0.5 })).previewSupported,
    false,
  )
})

test('time labels handle minute rollover and invalid values', () => {
  assert.equal(exportTime(59.96), '1:00.0')
  assert.equal(exportTime(4.2), '0:04.2')
  assert.equal(exportTime(NaN), '0:00.0')
})
