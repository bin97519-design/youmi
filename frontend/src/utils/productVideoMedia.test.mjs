import assert from 'node:assert/strict'
import test from 'node:test'
import { productVideoAssetSize, productVideoDimensionsPatch } from './productVideoMedia.js'

test('actual output dimensions override the planned ratio', () => {
  const size = productVideoAssetSize({
    url: '/video.mp4',
    ratio: '3:4',
    mediaWidth: 1920,
    mediaHeight: 1080,
  })
  assert.deepEqual(size, {
    width: 360,
    height: 203,
    naturalWidth: 1920,
    naturalHeight: 1080,
    productVideoMediaUrl: '/video.mp4',
    productVideoCanvasSizeVersion: 1,
  })
  assert.equal(
    productVideoAssetSize({ ratio: '16:9', mediaWidth: 1080, mediaHeight: 1920 }).height,
    640,
  )
})

test('unknown dimensions use a finite placeholder but never invent natural dimensions', () => {
  for (const ratio of ['adaptive', '', '0:4', 'bad:9', 'Infinity:3', '1:2:3']) {
    const size = productVideoAssetSize({ ratio })
    assert.equal(size.width, 360)
    assert.equal(size.height, 203)
    assert.equal(size.naturalWidth, 0)
    assert.equal(size.naturalHeight, 0)
    assert.equal(size.productVideoMediaUrl, '')
  }
  assert.equal(productVideoAssetSize({ ratio: '3:4' }).height, 480)
  assert.equal(productVideoAssetSize({ request: { size: '1:1' } }).height, 360)
})

test('legacy asset repair preserves position and normalizes width to 360', () => {
  const layer = {
    productVideoShotId: 'shot',
    type: 'video',
    url: '/v.mp4',
    x: 50,
    y: 100,
    width: 320,
    height: 427,
    naturalWidth: 240,
    naturalHeight: 320,
  }
  const patch = productVideoDimensionsPatch(layer, { width: 1920, height: 1080 })
  assert.deepEqual(patch, {
    width: 360,
    height: 203,
    naturalWidth: 1920,
    naturalHeight: 1080,
    productVideoMediaUrl: '/v.mp4',
    productVideoCanvasSizeVersion: 1,
  })
  const repaired = { ...layer, ...patch }
  assert.equal(repaired.x, 50)
  assert.equal(repaired.y, 100)
  assert.equal(productVideoDimensionsPatch(repaired, { width: 1920, height: 1080 }), null)
  const portrait = productVideoDimensionsPatch(
    { ...layer, height: 180 },
    { width: 1080, height: 1920 },
  )
  assert.equal(portrait.height, 640)
  assert.equal(portrait.width, 360)
})

test('previously verified narrow layers migrate once without resetting later manual sizes', () => {
  for (const width of [314, 320]) {
    const size = { width: 640, height: 360 }
    const layer = {
      productVideoShotId: 'shot',
      type: 'image',
      url: '/i.png',
      productVideoMediaUrl: '/i.png',
      naturalWidth: size.width,
      naturalHeight: size.height,
      width,
      height: 180,
    }
    const patch = productVideoDimensionsPatch(layer, size)
    assert.equal(patch.width, 360)
    assert.equal(patch.height, 203)
    const resized = { ...layer, ...patch, width: 720, height: 405 }
    assert.equal(productVideoDimensionsPatch(resized, size), null)
  }
})

test('new assets retain a manual width if real dimensions arrive later', () => {
  const layer = {
    ...productVideoAssetSize({ url: '/i.png', ratio: '3:4' }),
    productVideoShotId: 'shot',
    type: 'image',
    url: '/i.png',
    width: 720,
    height: 960,
  }
  const patch = productVideoDimensionsPatch(layer, { width: 1920, height: 1080 })
  assert.equal(patch.width, 720)
  assert.equal(patch.height, 405)
})

test('ordinary layers, deliberate slices, invalid metadata and stale URLs are not trusted', () => {
  assert.equal(productVideoDimensionsPatch({ type: 'image' }, { width: 640, height: 360 }), null)
  const layer = {
    productVideoShotId: 'shot',
    type: 'image',
    url: '/new.png',
    productVideoMediaUrl: '/old.png',
    width: 320,
    height: 180,
    naturalWidth: 640,
    naturalHeight: 360,
  }
  assert.equal(
    productVideoDimensionsPatch({ ...layer, horizontalSlice: true }, { width: 640, height: 360 }),
    null,
  )
  assert.equal(productVideoDimensionsPatch(layer, { width: 0, height: 360 }), null)
  assert.equal(
    productVideoDimensionsPatch(layer, { width: 640, height: 360 }).productVideoMediaUrl,
    '/new.png',
  )
})
