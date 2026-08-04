import assert from 'node:assert/strict'
import test from 'node:test'

import { expandMainImagePrompt } from '../src/utils/canvasCreative.js'
import { resolveSupportedImageRatio } from '../src/utils/imageRatio.js'

test('maps reference image dimensions to supported generation sizes', () => {
  assert.equal(resolveSupportedImageRatio({ naturalWidth: 1024, naturalHeight: 1024 }), '1:1')
  assert.equal(resolveSupportedImageRatio({ naturalWidth: 900, naturalHeight: 1200 }), '3:4')
  assert.equal(resolveSupportedImageRatio({ naturalWidth: 1200, naturalHeight: 900 }), '4:3')
  assert.equal(resolveSupportedImageRatio({ naturalWidth: 1024, naturalHeight: 1365 }), '3:4')
  assert.equal(resolveSupportedImageRatio({ naturalWidth: 1920, naturalHeight: 1080 }), '16:9')
})

test('uses a valid fallback when image dimensions are unavailable', () => {
  assert.equal(resolveSupportedImageRatio({}, '4:5'), '4:5')
  assert.equal(resolveSupportedImageRatio({}, '0.75:1'), '1:1')
})

test('keeps the main-image prompt aligned with the reference-image output size', () => {
  assert.match(expandMainImagePrompt('layout'), /画幅比例与图2一致/)
  assert.match(expandMainImagePrompt('style'), /画幅比例与图2一致/)
})
