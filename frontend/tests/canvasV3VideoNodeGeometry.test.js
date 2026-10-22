import test from 'node:test'
import assert from 'node:assert/strict'
import { nodeSize } from '../src/features/canvas-v3/config/nodeGeometry.js'

test('video metadata preserves real portrait, wide and square aspect ratios inside existing node bounds', () => {
  for (const [mediaWidth, mediaHeight, expected] of [
    [1080, 1920, { width: 197, height: 350 }],
    [1920, 1080, { width: 622, height: 350 }],
    [2560, 1080, { width: 624, height: 263 }],
    [4096, 4096, { width: 350, height: 350 }],
  ]) {
    const data = { assetUrl: 'https://assets.example.com/video.mp4', mediaWidth, mediaHeight }
    const size = nodeSize('video', data)
    assert.deepEqual(size, expected)
    assert.ok(size.width > 0 && size.width <= 624)
    assert.ok(size.height > 0 && size.height <= 350)
    assert.ok(Math.abs(size.width / size.height - mediaWidth / mediaHeight) < 0.005)
    assert.deepEqual(data, {
      assetUrl: 'https://assets.example.com/video.mp4',
      mediaWidth,
      mediaHeight,
    })
  }
})

test('missing video metadata retains existing default size and never resizes an unrelated node', () => {
  for (const data of [
    {},
    { mediaWidth: 1080, mediaHeight: 1920 },
    { assetUrl: 'video.mp4', mediaWidth: 0, mediaHeight: 1920 },
    { assetUrl: 'video.mp4', mediaWidth: 1080, mediaHeight: 0 },
  ])
    assert.deepEqual(nodeSize('video', data), { width: 624, height: 350 })
  assert.deepEqual(
    nodeSize('audio', { assetUrl: 'audio.wav', mediaWidth: 100, mediaHeight: 200 }),
    {
      width: 350,
      height: 350,
    },
  )
  assert.deepEqual(nodeSize('text'), { width: 350, height: 200 })
})

test('video geometry ignores image rotation while existing rotated image sizing is preserved', () => {
  const data = { assetUrl: 'asset', mediaWidth: 1920, mediaHeight: 1080 }
  for (const rotation of [0, 90, -90, 180, 270]) {
    assert.deepEqual(nodeSize('video', { ...data, rotation }), { width: 622, height: 350 })
    assert.deepEqual(
      nodeSize('image', { ...data, rotation }),
      [90, -90, 270].includes(rotation) ? { width: 197, height: 350 } : { width: 622, height: 350 },
    )
  }
})
