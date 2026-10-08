import test from 'node:test'
import assert from 'node:assert/strict'

import { imageMiCost, imageMiUnitPrice } from '../src/utils/imageMiPricing.js'

test('uses the configured model and resolution price matrix', () => {
  assert.equal(imageMiUnitPrice('banana2', '1K'), 8)
  assert.equal(imageMiUnitPrice('banana-pro', '2K'), 15)
  assert.equal(imageMiUnitPrice('banana-pro-api', '2K'), 15)
  assert.equal(imageMiUnitPrice('banana-2.1', '2K'), 9)
  assert.equal(imageMiUnitPrice('gpt image 2', '4K'), 15)
  assert.equal(imageMiUnitPrice('GPT-image2.5', '4K'), 15)
  assert.equal(imageMiUnitPrice('gpt-image2.5-sunburst-api', '4K'), 18)
})

test('multiplies the unit price by image count', () => {
  assert.equal(imageMiCost('banana2', '2K', 3), 27)
  assert.equal(imageMiCost('gpt-image-2', '1K', 2), 12)
  assert.equal(imageMiCost('gpt-image-2.5-sunburst', '4K', 2), 36)
  assert.equal(imageMiCost('banana21', '4K', 2), 24)
})
