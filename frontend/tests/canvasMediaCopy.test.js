import test from 'node:test'
import assert from 'node:assert/strict'
import {
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
