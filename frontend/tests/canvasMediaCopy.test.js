import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasMediaClipboardEntries,
  canvasMediaClipboardLayerFields,
  canvasMediaSummary,
  isCopyableCanvasMedia,
  partitionCanvasMediaCopies,
  transferableMediaKey,
} from '../src/utils/canvasMediaCopy.js'

const video = {
  id: 'video-1',
  type: 'video',
  url: 'https://cdn.test/Clip.mp4',
  width: 360,
  height: 480,
}
const image = { id: 'image-1', type: 'image', url: 'https://cdn.test/image.png' }

test('clipboard keeps video media metadata but excludes pending tasks and image detection', () => {
  const source = {
    ...video,
    zIndex: 2,
    x: 120,
    y: 80,
    naturalWidth: 1080,
    naturalHeight: 1440,
    posterUrl: 'https://cdn.test/poster.jpg',
    thumbnailUrl: 'https://cdn.test/thumb.jpg',
    duration: 15,
    genMeta: { model: 'minimax-h3', duration: 15 },
    videoMeta: { model: 'minimax-h3', resolution: '768p' },
    videoNodeDraft: { prompt: '脚本', references: [{ url: '/scene.png' }] },
    taskId: 'completed-task',
  }
  const before = JSON.stringify(source)
  const [entry] = canvasMediaClipboardEntries(
    [source, { ...video, id: 'pending', generating: true }],
    [source.id, 'pending'],
    { [source.id]: [{ name: 'not-an-image' }] },
  )
  const pasted = canvasMediaClipboardLayerFields(entry)
  for (const field of [
    'url',
    'type',
    'posterUrl',
    'thumbnailUrl',
    'duration',
    'naturalWidth',
    'naturalHeight',
  ]) {
    assert.equal(pasted[field], source[field])
  }
  assert.equal(pasted.width, 360)
  assert.equal(pasted.height, 480)
  assert.deepEqual(pasted.videoMeta, source.videoMeta)
  assert.deepEqual(pasted.videoNodeDraft, source.videoNodeDraft)
  pasted.videoNodeDraft.references[0].url = '/changed.png'
  assert.equal(entry.videoNodeDraft.references[0].url, '/scene.png')
  assert.deepEqual(entry.elements, [])
  assert.equal('taskId' in pasted, false)
  assert.equal('layerId' in pasted, false)
  assert.equal('elements' in pasted, false)
  pasted.genMeta.model = 'changed'
  assert.equal(entry.genMeta.model, 'minimax-h3')
  entry.genMeta.duration = 4
  assert.equal(JSON.stringify(source), before)
})

test('clipboard supports mixed selections and legacy images while retaining image detections', () => {
  const legacy = { ...image, type: undefined, zIndex: 1 }
  const detections = { [legacy.id]: [{ box: [0, 0, 1, 1] }] }
  const entries = canvasMediaClipboardEntries(
    [{ ...video, zIndex: 2 }, legacy, { id: 'text', type: 'text', url: image.url }],
    [legacy.id, video.id, 'text'],
    detections,
  )
  assert.deepEqual(
    entries.map((entry) => entry.layerId),
    [legacy.id, video.id],
  )
  assert.equal(canvasMediaSummary(entries), '1 张图片、1 个视频')
  const fields = canvasMediaClipboardLayerFields(entries[0], 'https://cdn.test/resized.jpg')
  assert.equal(fields.type, 'image')
  assert.equal(fields.thumbnailUrl, 'https://cdn.test/resized.jpg')
  assert.deepEqual(entries[0].elements, detections[legacy.id])
  entries[0].elements[0].box[0] = 0.5
  assert.equal(detections[legacy.id][0].box[0], 0)
})

test('cross-canvas copies accept finished videos and images, not pending media or text', () => {
  assert.equal(isCopyableCanvasMedia(video), true)
  assert.equal(isCopyableCanvasMedia(image), true)
  assert.equal(isCopyableCanvasMedia({ id: 'legacy', url: image.url }), true)
  for (const layer of [
    null,
    { type: 'video' },
    { ...video, generating: true },
    { type: 'placeholder', url: image.url },
    { type: 'text', url: image.url },
  ]) {
    assert.equal(isCopyableCanvasMedia(layer), false)
  }
})

test('copy counts distinguish videos, images and mixed selections', () => {
  assert.equal(canvasMediaSummary([video]), '1 个视频')
  assert.equal(canvasMediaSummary([image]), '1 张图片')
  assert.equal(canvasMediaSummary([video, image]), '1 张图片、1 个视频')
  assert.equal(canvasMediaSummary([]), '0 项素材')
})

test('duplicate video URLs ignore refreshed signatures but preserve path case and media type', () => {
  const key = transferableMediaKey(video)
  assert.equal(transferableMediaKey({ ...video, url: `${video.url}?signature=new` }), key)
  assert.notEqual(transferableMediaKey({ ...video, url: video.url.toLowerCase() }), key)
  assert.notEqual(transferableMediaKey({ ...video, type: 'image' }), key)
  assert.equal(transferableMediaKey({ ...video, url: '/Clip.mp4' }, 'https://cdn.test/editor'), key)
})

test('copy retry and mixed selections deduplicate without changing source or target layers', () => {
  const sources = [video, image, { ...video, id: 'same-video' }]
  const existing = [
    {
      ...video,
      id: 'copy-video',
      url: `${video.url}?signature=old`,
      copiedFromCanvasId: 'source',
      copiedFromLayerId: video.id,
    },
  ]
  const before = JSON.stringify({ sources, existing })
  const result = partitionCanvasMediaCopies(sources, existing, 'source')
  assert.deepEqual(result.copies, [image])
  assert.deepEqual(
    result.skipped.map((layer) => layer.id),
    [video.id, 'same-video'],
  )
  assert.equal(JSON.stringify({ sources, existing }), before)
})

test('a video poster or unfinished placeholder does not suppress the actual video', () => {
  const existing = [
    { ...video, type: 'image' },
    { ...video, generating: true },
  ]
  assert.deepEqual(partitionCanvasMediaCopies([video], existing, 'source').copies, [video])
})
