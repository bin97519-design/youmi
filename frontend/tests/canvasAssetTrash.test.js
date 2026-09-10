import assert from 'node:assert/strict'
import test from 'node:test'
import {
  archiveCanvasAssetDeletion,
  restoreCanvasAssetDeletion,
} from '../src/utils/canvasAssetTrash.js'

function createPayload() {
  return {
    layers: [
      { id: 'a', url: 'a.jpg' },
      { id: 'b', url: 'b.jpg' },
      { id: 'c', url: 'c.jpg' },
      { id: 'd', url: 'd.jpg' },
    ],
    connections: [
      { fromLayerId: 'a', fromPort: 'right', toLayerId: 'b', toPort: 'left' },
      { fromLayerId: 'c', fromPort: 'right', toLayerId: 'd', toPort: 'left' },
    ],
    detectedElements: {
      b: [{ id: 'b-1' }],
      c: [{ id: 'c-1' }],
    },
    reversePrompt: {
      referenceImages: [
        { layerId: 'b', url: 'b.jpg' },
        { layerId: 'd', url: 'd.jpg' },
      ],
    },
    deletedAssetBatches: [],
  }
}

test('restores a deleted batch after payload serialization', () => {
  const payload = createPayload()

  const archived = archiveCanvasAssetDeletion(payload, ['b', 'c'], {
    batchId: 'batch-1',
    deletedAt: 100,
  })
  assert.deepEqual(archived.deletedIds, ['b', 'c'])
  assert.deepEqual(
    payload.layers.map((layer) => layer.id),
    ['a', 'd'],
  )
  assert.deepEqual(payload.connections, [])
  assert.deepEqual(payload.detectedElements, {})
  assert.deepEqual(payload.reversePrompt.referenceImages, [{ layerId: 'd', url: 'd.jpg' }])

  const reloadedPayload = JSON.parse(JSON.stringify(payload))
  const restored = restoreCanvasAssetDeletion(reloadedPayload)

  assert.deepEqual(restored.restoredIds, ['b', 'c'])
  assert.deepEqual(
    reloadedPayload.layers.map((layer) => layer.id),
    ['a', 'b', 'c', 'd'],
  )
  assert.equal(reloadedPayload.connections.length, 2)
  assert.deepEqual(reloadedPayload.detectedElements, {
    b: [{ id: 'b-1' }],
    c: [{ id: 'c-1' }],
  })
  assert.equal(reloadedPayload.reversePrompt.referenceImages.length, 2)
  assert.deepEqual(reloadedPayload.deletedAssetBatches, [])
})

test('restores the latest batch first and avoids duplicate layers', () => {
  const payload = createPayload()
  archiveCanvasAssetDeletion(payload, ['b'], { batchId: 'batch-1', deletedAt: 100 })
  archiveCanvasAssetDeletion(payload, ['c'], { batchId: 'batch-2', deletedAt: 200 })

  assert.deepEqual(restoreCanvasAssetDeletion(payload), {
    batchId: 'batch-2',
    restoredIds: ['c'],
  })
  assert.deepEqual(
    payload.layers.map((layer) => layer.id),
    ['a', 'c', 'd'],
  )
  assert.deepEqual(restoreCanvasAssetDeletion(payload).restoredIds, ['b'])
  assert.deepEqual(
    payload.layers.map((layer) => layer.id),
    ['a', 'b', 'c', 'd'],
  )
  assert.deepEqual(restoreCanvasAssetDeletion(payload).restoredIds, [])
})
