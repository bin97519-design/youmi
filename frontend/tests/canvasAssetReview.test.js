import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CANVAS_ASSET_REVIEW_STATUS,
  isCanvasAssetKept,
  isReviewableCanvasAsset,
  selectedReviewableCanvasAssets,
  unmarkedCanvasAssets,
} from '../src/utils/canvasAssetReview.js'

const layers = [
  { id: 'legacy-image', url: 'https://example.com/legacy.png' },
  { id: 'image', type: 'image', url: 'https://example.com/image.png' },
  {
    id: 'kept-video',
    type: 'video',
    url: 'https://example.com/video.mp4',
    assetReviewStatus: CANVAS_ASSET_REVIEW_STATUS.KEPT,
  },
  { id: 'video-placeholder', type: 'video', url: '' },
  { id: 'placeholder', type: 'placeholder', url: 'https://example.com/preview.png' },
  { id: 'text', type: 'text', url: 'https://example.com/not-media.png' },
]

test('only completed image and video layers can be reviewed', () => {
  assert.equal(isReviewableCanvasAsset(layers[0]), true)
  assert.equal(isReviewableCanvasAsset(layers[1]), true)
  assert.equal(isReviewableCanvasAsset(layers[2]), true)
  assert.equal(isReviewableCanvasAsset(layers[3]), false)
  assert.equal(isReviewableCanvasAsset(layers[4]), false)
  assert.equal(isReviewableCanvasAsset(layers[5]), false)
})

test('recognizes kept assets and returns only selected reviewable media', () => {
  assert.equal(isCanvasAssetKept(layers[2]), true)
  assert.equal(isCanvasAssetKept(layers[1]), false)
  assert.deepEqual(
    selectedReviewableCanvasAssets(layers, ['image', 'text', 'kept-video']).map(({ id }) => id),
    ['image', 'kept-video'],
  )
})

test('bulk cleanup excludes marked, placeholder and text layers', () => {
  assert.deepEqual(
    unmarkedCanvasAssets(layers).map(({ id }) => id),
    ['legacy-image', 'image'],
  )
})
