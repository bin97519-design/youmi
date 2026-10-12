import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasDocumentAssetCounts,
  isCanvasDocumentImageLayer,
} from '../src/utils/canvasDocumentAssets.js'

test('canvas cards separately count images, video nodes and text nodes', () => {
  const layers = [
    { type: 'image', url: 'https://assets.test/image.png' },
    { url: 'https://assets.test/legacy.png', visible: false },
    { type: 'image', url: '' },
    { type: 'video', url: 'https://assets.test/clip.mp4' },
    { type: 'video', url: '', generating: true },
    { type: 'video', url: '', videoNodeDraft: { prompt: '' } },
    { type: 'text', text: 'A script' },
    { type: 'text', text: '', videoReversePrompt: { status: 'processing' } },
    { type: 'placeholder', url: 'https://assets.test/placeholder.png' },
    { type: 'image-placeholder', url: 'https://assets.test/placeholder.png' },
    null,
  ]
  assert.deepEqual(canvasDocumentAssetCounts({ payload: { layers } }), {
    images: 2, videos: 3, texts: 2,
  })
  assert.equal(layers.filter(isCanvasDocumentImageLayer).length, 2)
})

test('empty or malformed canvas payloads have zero counts', () => {
  for (const doc of [null, {}, { payload: {} }, { payload: { layers: null } }, { payload: { layers: {} } }, { payload: { layers: [] } }]) {
    assert.deepEqual(canvasDocumentAssetCounts(doc), { images: 0, videos: 0, texts: 0 })
  }
})

test('counts update when nodes are added, replaced or removed without mutating the document', () => {
  const doc = { payload: { layers: [{ type: 'video', url: '' }] } }
  assert.deepEqual(canvasDocumentAssetCounts(doc), { images: 0, videos: 1, texts: 0 })
  doc.payload.layers[0].url = 'https://assets.test/clip.mp4'
  doc.payload.layers.push({ type: 'text', text: 'Prompt' })
  const snapshot = structuredClone(doc)
  assert.deepEqual(canvasDocumentAssetCounts(doc), { images: 0, videos: 1, texts: 1 })
  assert.deepEqual(doc, snapshot)
  doc.payload.layers.splice(0, 1)
  assert.deepEqual(canvasDocumentAssetCounts(doc), { images: 0, videos: 0, texts: 1 })
})
