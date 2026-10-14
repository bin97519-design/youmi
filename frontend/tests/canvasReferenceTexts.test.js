import test from 'node:test'
import assert from 'node:assert/strict'
import {
  selectedConnectionMedia,
  incomingImageReferencesByNode,
  incomingVideoReferencesByNode,
  incomingTextReferencesByNode,
} from '../src/utils/canvasNodeConnections.js'
import {
  normalizeReferenceTexts,
  canvasReferenceTextPrompt,
  canvasReferenceTextError,
} from '../src/utils/canvasReferenceTexts.js'
import {
  normalizeImageNodeDraft,
  syncImageNodeConnectedReferences,
  imageNodeGenerationOptions,
} from '../src/utils/imageNodeDraft.js'
import {
  normalizeVideoNodeDraft,
  syncVideoNodeConnectedReferences,
  videoNodeReferenceError,
} from '../src/utils/videoNodeDraft.js'
import { ANMIAO25_VIDEO_MODEL } from '../src/utils/productVideo.js'

const layers = [
  {
    id: 'video',
    type: 'video',
    url: 'https://assets.example/clip.mp4',
    generating: true,
    status: 'processing',
    duration: 5,
    x: 0,
    y: 0,
  },
  { id: 'photo', type: 'image', url: 'https://assets.example/photo.png', x: 0, y: 100 },
  {
    id: 'script',
    type: 'text',
    text: 'Continue moving right without resetting the action.',
    name: 'Script',
    x: 0,
    y: 200,
  },
]
const edges = layers.map((layer) => ({
  fromLayerId: layer.id,
  fromPort: 'right',
  toLayerId: 'target',
  toPort: 'left',
}))
const refs = { layerId: 'script', text: layers[2].text, name: 'Script' }

test('mixed image, video and text selection exposes one connector in visual order', () => {
  assert.deepEqual(
    selectedConnectionMedia(layers, ['script', 'photo', 'video']).map((layer) => layer.id),
    ['video', 'photo', 'script'],
  )
  assert.equal(
    selectedConnectionMedia(
      [...layers, { id: 'empty-text', type: 'text', text: '' }],
      ['video', 'empty-text'],
    ).length,
    2,
  )
  assert.equal(
    selectedConnectionMedia(
      [...layers, { id: 'pending', type: 'video', generating: true, url: '' }],
      ['video', 'pending'],
    ).length,
    0,
  )
})

test('graph inputs keep scripts, image URLs and returned video URLs separate', () => {
  assert.deepEqual(incomingTextReferencesByNode(layers, edges).get('target'), [refs])
  assert.deepEqual(
    incomingImageReferencesByNode(layers, edges)
      .get('target')
      .map((ref) => ref.layerId),
    ['photo'],
  )
  assert.deepEqual(
    incomingVideoReferencesByNode(layers, edges)
      .get('target')
      .map((ref) => ref.layerId),
    ['video'],
  )
  assert.equal(incomingTextReferencesByNode([{ ...layers[2], text: '' }], edges).size, 0)
})

test('image references synchronize text changes without overwriting the authored prompt', () => {
  let draft = normalizeImageNodeDraft({ prompt: 'Product photo', config: { model: 'model' } }, {}, [
    'model',
  ])
  const images = incomingImageReferencesByNode(layers, edges).get('target')
  draft = syncImageNodeConnectedReferences(draft, images, ['model'], [refs])
  assert.equal(draft.prompt, 'Product photo')
  assert.deepEqual(draft.referenceTexts, [refs])
  assert.deepEqual(normalizeImageNodeDraft(JSON.parse(JSON.stringify(draft)), {}, ['model']), draft)
  const updated = { ...refs, text: 'Inspect the weave, keep the curtain closed.' }
  draft = syncImageNodeConnectedReferences(draft, images, ['model'], [updated])
  const options = imageNodeGenerationOptions({ id: 'target', type: 'image-placeholder' }, draft)
  assert.match(options.fullPrompt, /Product photo/)
  assert.match(options.fullPrompt, /Inspect the weave/)
  assert.doesNotMatch(options.fullPrompt, /Continue moving right/)
  assert.deepEqual(options.referenceImageUrls, [layers[1].url])
  assert.deepEqual(options.referenceTextLayerIds, ['script'])
  draft = syncImageNodeConnectedReferences(draft, images, ['model'], [])
  assert.deepEqual(draft.referenceTexts, [])
  assert.equal(draft.references.length, 1)
  assert.equal(draft.prompt, 'Product photo')
})

test('native video drafts persist mixed inputs and allow connected scripts as the prompt', () => {
  const draft = syncVideoNodeConnectedReferences(
    normalizeVideoNodeDraft({ config: { model: ANMIAO25_VIDEO_MODEL, duration: 5 } }),
    incomingImageReferencesByNode(layers, edges).get('target'),
    undefined,
    incomingVideoReferencesByNode(layers, edges).get('target'),
    [refs],
  )
  assert.equal(draft.prompt, '')
  assert.equal(draft.config.referenceMode, 'cankaosheng')
  assert.equal(draft.references.length, 1)
  assert.equal(draft.referenceVideos.length, 1)
  assert.deepEqual(draft.referenceTexts, [refs])
  assert.deepEqual(normalizeVideoNodeDraft(JSON.parse(JSON.stringify(draft))), draft)
  assert.match(
    canvasReferenceTextPrompt(draft.prompt, draft.referenceTexts, 2500),
    /Continue moving right/,
  )
  assert.equal(videoNodeReferenceError(draft), '')
})

test('text prompt composition preserves content, avoids duplicate replay text and rejects overflow', () => {
  const prompt = canvasReferenceTextPrompt('Base prompt', [refs], 2500)
  assert.equal(canvasReferenceTextPrompt(prompt, [refs], 2500), prompt)
  assert.deepEqual(normalizeReferenceTexts([refs, refs, null, { text: '' }]), [refs])
  assert.throws(
    () => canvasReferenceTextPrompt('Base', [{ ...refs, text: 'x'.repeat(2500) }], 2500),
    /2500/,
  )
  assert.match(
    canvasReferenceTextError('Base', [{ ...refs, text: 'x'.repeat(2500) }], 2500),
    /2500/,
  )
})
