import test from 'node:test'
import assert from 'node:assert/strict'

import { imageMiCost, imageMiUnitPrice } from '../src/utils/imageMiPricing.js'

test('uses the configured model and resolution price matrix', () => {
  assert.equal(imageMiUnitPrice('banana2', '1K'), 8)
  assert.equal(imageMiUnitPrice('banana-pro', '2K'), 15)
  assert.equal(imageMiUnitPrice('gpt image 2', '4K'), 15)
})

test('multiplies the unit price by image count', () => {
  assert.equal(imageMiCost('banana2', '2K', 3), 27)
  assert.equal(imageMiCost('gpt-image-2', '1K', 2), 12)
})
