import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mappedImageModelOption,
  newProductVideo,
  newShot,
  buildImageRequest,
} from '../src/utils/productVideo.js'

const options = [
  { value: 'banana-2.1', label: 'banana-2.1', model: 'banana-2.1' },
  { value: '香蕉pro', label: '香蕉pro', model: 'banana-pro' },
  { value: 'image-2.5快速', label: 'image-2.5快速', model: 'tt-image-2.5' },
  { value: 'image-2.5高质', label: 'image-2.5高质', model: 'tt-image-2.5' },
]

test('image mappings accept saved names and IDs with case and whitespace normalization', () => {
  assert.equal(mappedImageModelOption('banana-pro', options), options[1])
  assert.equal(mappedImageModelOption('香蕉pro', options), options[1])
  assert.equal(mappedImageModelOption('  BANANA-PRO  ', options), options[1])
  assert.equal(mappedImageModelOption(' Image-2.5高质 ', options), options[3])
})

test('image route names retain distinct choices sharing a canonical model ID', () => {
  assert.equal(mappedImageModelOption('image-2.5快速', options), options[2])
  assert.equal(mappedImageModelOption('image-2.5高质', options), options[3])
  assert.equal(mappedImageModelOption('tt-image-2.5', options), options[2])
  const overlapping = [{ value: 'banana-pro', model: 'different-model' }, options[1]]
  assert.equal(mappedImageModelOption('banana-pro', overlapping), overlapping[0])
})

test('excluded image models never fall back to another mapped model', () => {
  for (const model of ['', null, undefined, 'gpt-image-2', 'image-2.5'])
    assert.equal(mappedImageModelOption(model, options), undefined)
  assert.equal(mappedImageModelOption('banana-2.1', []), undefined)
})

test('image request uses the resolved route name without changing saved task data', () => {
  const workflow = newProductVideo()
  workflow.continuity.enabled = false
  workflow.imageModel = ' Image-2.5高质 '
  workflow.references = [{ id: 'product', url: 'https://media.example/product.jpg' }]
  const shot = newShot({ imagePrompt: '商品首帧' })
  shot.referenceIds = ['product']
  workflow.shots = [shot]
  const option = mappedImageModelOption(workflow.imageModel, options)
  const request = buildImageRequest({ ...workflow, imageModel: option.value }, shot, 'image')
  assert.equal(request.model, 'image-2.5高质')
  assert.notEqual(request.model, 'tt-image-2.5')
  assert.equal(workflow.imageModel, ' Image-2.5高质 ')
  assert.equal(request.resolution, '2K')
})
