import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  directorApplyImageSourceIntent,
  directorReferenceImages,
} from '../src/features/canvas-v3/config/directorImageSources.js'
import { directorRequestContextLayers } from '../src/features/canvas-v3/config/directorConversation.js'
import { serializeDirectorAttachment } from '../src/features/canvas-v3/config/directorAttachments.js'

const originalImage = {
  id: 'old',
  layerId: 'old',
  kind: 'image',
  url: 'old-image',
  source: 'canvas',
}
const uploadedImage = {
  id: 'upload',
  layerId: 'upload',
  kind: 'image',
  url: 'new-image',
  status: 'ready',
  source: 'upload',
}
const document = { id: 'brief', layerId: 'brief', kind: 'file', url: 'brief-document' }
const intent = Object.freeze({
  generationType: 'image',
  requestedModels: [{ id: 'selected-model' }],
  nodeModel: 'selected-model',
  ratio: '1:1',
  resolution: '2K',
  count: 1,
  quality: '标准画质',
  selectedLayerIds: ['old', 'text-node'],
  referenceLayerIds: ['old', 'upload', 'brief'],
  referenceAssets: [originalImage, uploadedImage],
  attachments: [uploadedImage, document],
})

test('explicit text-to-image removes inherited image references without changing paid settings', () => {
  const result = directorApplyImageSourceIntent(intent, 'text', [originalImage, uploadedImage])
  assert.equal(result.imageSourceMode, 'text')
  assert.deepEqual(result.referenceAssets, [])
  assert.deepEqual(result.attachments, [document])
  assert.deepEqual(result.referenceLayerIds, ['brief'])
  assert.deepEqual(result.selectedLayerIds, ['text-node'])
  for (const key of [
    'generationType',
    'requestedModels',
    'nodeModel',
    'ratio',
    'resolution',
    'count',
    'quality',
  ])
    assert.deepEqual(result[key], intent[key])
  assert.equal(intent.referenceAssets.length, 2)
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.referenceAssets))
})

test('text mode prevents canvas image URLs from leaking back into the model request', () => {
  const result = directorRequestContextLayers(
    [
      { id: 'old', type: 'image', url: 'old-image' },
      { id: 'unrelated-output', type: 'image', url: 'unrelated-image' },
      { id: 'text-node', type: 'text', url: '' },
    ],
    directorApplyImageSourceIntent(intent, 'text'),
  )
  assert.ok(result.filter((layer) => layer.type === 'image').every((layer) => !layer.url))
  assert.equal(result.find((layer) => layer.id === 'brief').url, 'brief-document')
})

test('reference selection honors removals, keeps roles, and does not silently reuse other outputs', () => {
  const failed = { id: 'bad', kind: 'image', url: 'failed-url', status: 'error' }
  const available = directorReferenceImages(
    intent,
    [uploadedImage, failed, { id: 'video', kind: 'video', url: 'video' }],
    ['old'],
    { upload: 'style' },
  )
  assert.deepEqual(
    available.map(({ id }) => id),
    ['upload', 'bad'],
  )
  assert.equal(available[0].referenceRole, 'style')
  const result = directorApplyImageSourceIntent(intent, 'reference', available)
  assert.deepEqual(
    result.referenceAssets.map(({ id }) => id),
    ['upload'],
  )
  assert.equal(result.referenceAssets[0].referenceRole, 'style')
  assert.deepEqual(result.referenceLayerIds, ['brief', 'upload'])
  assert.deepEqual(result.selectedLayerIds, ['text-node'])
  assert.deepEqual(result.requestedModels, intent.requestedModels)
  assert.equal(directorApplyImageSourceIntent(intent, ''), intent)
})

test('attachment serialization keeps only allowed reference purposes', () => {
  assert.equal(
    serializeDirectorAttachment({ ...uploadedImage, referenceRole: 'product' }).referenceRole,
    'product',
  )
  assert.equal(
    serializeDirectorAttachment({ ...uploadedImage, referenceRole: 'style' }).referenceRole,
    'style',
  )
  assert.equal(
    serializeDirectorAttachment({ ...uploadedImage, referenceRole: 'invented' }).referenceRole,
    undefined,
  )
})

test('Panel and Shell wire typed upload validation to real reference snapshots', async () => {
  const panel = await readFile(
    new URL('../src/features/canvas-v3/components/DirectorPanel.vue', import.meta.url),
    'utf8',
  )
  const shell = await readFile(
    new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
    'utf8',
  )
  assert.match(panel, /#reference-upload/)
  assert.match(panel, /<DirectorReferenceUpload/)
  assert.match(panel, /:reference-images="pendingReferenceImages"/)
  assert.match(panel, /:uploading="attachmentUploadActive"/)
  assert.match(panel, /@image-source-change="changeImageSource"/)
  assert.match(
    panel,
    /isDirectorClarificationReady\(run.questions, answers, pendingReferenceImages.value\)/,
  )
  assert.match(shell, /isDirectorClarificationReady\(source.questions, answers, referenceImages\)/)
  assert.match(shell, /directorApplyImageSourceIntent\(addedIntent, sourceMode, referenceImages\)/)
  assert.match(shell, /dryRunIntent: source\.dryRun !== false/)
  assert.doesNotMatch(
    shell.match(/function handleDirectorClarification[\s\S]*?\n\}/)?.[0] || '',
    /directorDryRun|localStorage/,
  )
})
