import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVideoSavedAssetClient,
  savedAssetMediaKind,
  videoAssetSourceUrl,
  videoSavedAssetInfo,
  videoSavedAssetPayload,
} from '../src/features/canvas-v3/sync/videoSavedAssetClient.js'
import { createImageSavedAssetClient } from '../src/features/canvas-v3/sync/imageSavedAssetClient.js'

const videoUrl = 'https://assets.example.com/clip.mp4'
const posterUrl = 'https://assets.example.com/cover.png'
const draft = () => ({
  name: '视频素材',
  videoUrl,
  posterUrl,
  folderId: 'uncategorized',
  folderPath: ['待分类资产'],
  tags: ['人物', '人物'],
  sourceNodeId: 'video-node',
  width: 1280,
  height: 720,
  duration: 12,
})
const response = (data, extra = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 0, data }),
  ...extra,
})
const saved = () => ({ ...videoSavedAssetPayload(draft()), id: 'video-asset' })

test('video assets carry explicit media identity and never enter image-only saved lists', async () => {
  const record = saved()
  assert.equal(record.imageUrl, '')
  assert.equal(record.coverUrl, posterUrl)
  assert.equal(record.config.mediaKind, 'video')
  assert.equal(record.config.videoUrl, videoUrl)
  assert.equal(savedAssetMediaKind(record), 'video')
  assert.deepEqual(videoSavedAssetInfo(record), {
    url: videoUrl,
    posterUrl,
    width: 1280,
    height: 720,
    duration: 12,
  })
  const client = createImageSavedAssetClient({ fetcher: async () => response([record]) })
  assert.deepEqual(await client.list(), [])
})

test('media identity is never guessed from a filename, thumbnail or a stale image field', () => {
  const legacy = {
    id: 'image',
    name: '视频.mp4',
    imageUrl: posterUrl,
    config: { libraryKind: 'asset' },
  }
  assert.equal(savedAssetMediaKind(legacy), 'image')
  assert.equal(videoSavedAssetInfo(legacy), null)
  for (const config of [
    { libraryKind: 'asset', mediaKind: 'unknown' },
    { libraryKind: 'asset', mediaKind: 'video', videoUrl: 'javascript:alert(1)' },
    { libraryKind: 'model', mediaKind: 'video', videoUrl },
    { libraryKind: 'product', mediaKind: 'video', videoUrl },
  ]) {
    assert.equal(savedAssetMediaKind({ ...legacy, config }), '')
    assert.equal(videoSavedAssetInfo({ ...legacy, config }), null)
  }
})

test('save uses the account-owned endpoint and only whitelists descriptive video metadata', async () => {
  const calls = []
  const client = createVideoSavedAssetClient({
    path: (path) => `/proxy${path}`,
    headers: () => ({ Authorization: 'Bearer test-only-token' }),
    fetcher: async (url, options) => {
      calls.push([url, options])
      return response({ ...JSON.parse(options.body), id: 'confirmed' })
    },
  })
  const source = {
    ...draft(),
    generation: { providerKey: 'never-copy' },
    config: { secret: 'never-copy' },
  }
  const before = JSON.stringify(source)
  assert.equal((await client.save(source)).id, 'confirmed')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/proxy/api/canvas/characters')
  assert.equal(calls[0][1].method, 'POST')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-only-token')
  const body = JSON.parse(calls[0][1].body)
  assert.equal(body.imageUrl, '')
  assert.equal(body.config.videoUrl, videoUrl)
  assert.deepEqual(body.config.canvasAsset.tags, ['人物'])
  assert.equal(JSON.stringify(body).includes('never-copy'), false)
  assert.equal(JSON.stringify(source), before)
})

test('invalid names, directories and ephemeral or credentialed sources never call the backend', async () => {
  let calls = 0
  const client = createVideoSavedAssetClient({
    fetcher: async () => {
      calls++
      return response({})
    },
  })
  for (const videoUrl of [
    'javascript:alert(1)',
    'file:///clip.mp4',
    'blob:https://example.com/id',
    'data:video/mp4;base64,AAAA',
    'https://user:pass@example.com/clip.mp4',
    'https://example.com/a b.mp4',
  ]) {
    assert.equal(videoAssetSourceUrl(videoUrl), '')
    await assert.rejects(client.save({ ...draft(), videoUrl }))
  }
  for (const patch of [
    { name: '' },
    { name: 'a'.repeat(51) },
    { name: 'a\0b' },
    { folderId: '' },
    { folderPath: [] },
  ])
    await assert.rejects(client.save({ ...draft(), ...patch }))
  assert.equal(calls, 0)
})

test('missing or malformed posters and metadata never introduce fake dimensions or duration', () => {
  const payload = videoSavedAssetPayload({
    ...draft(),
    posterUrl: 'javascript:alert(1)',
    width: -1,
    height: Infinity,
    duration: NaN,
  })
  const info = videoSavedAssetInfo(payload)
  assert.deepEqual(info, { url: videoUrl, posterUrl: '' })
  assert.equal(payload.imageUrl, '')
  assert.equal(payload.coverUrl, '')
  assert.equal(payload.config.canvasAsset.duration, undefined)
})

test('one cloud read can list explicit videos plus backward-compatible saved images', async () => {
  const calls = []
  const video = saved()
  const image = { id: 'image', name: '图片', imageUrl: posterUrl, config: { libraryKind: 'asset' } }
  const client = createVideoSavedAssetClient({
    fetcher: async (url, options) => {
      calls.push([url, options])
      return response([video, image, { ...image, id: 'model', config: {} }])
    },
  })
  const controller = new AbortController()
  assert.deepEqual(
    (await client.list({ includeImages: true, signal: controller.signal })).map(
      (record) => record.id,
    ),
    ['video-asset', 'image'],
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].method, 'GET')
  assert.equal(calls[0][1].signal, controller.signal)
  assert.deepEqual(
    (await client.list()).map((record) => record.id),
    ['video-asset'],
  )
})

test('failed saves, mismatched confirmations and aborted reads never report successful assets', async () => {
  const invalid = createVideoSavedAssetClient({
    fetcher: async () =>
      response({
        id: 'wrong',
        name: 'wrong',
        imageUrl: posterUrl,
        config: { libraryKind: 'asset' },
      }),
  })
  await assert.rejects(invalid.save(draft()), /未确认/)
  const mismatch = createVideoSavedAssetClient({
    fetcher: async () =>
      response({
        ...saved(),
        config: { ...saved().config, videoUrl: 'https://assets.example.com/other.mp4' },
      }),
  })
  await assert.rejects(mismatch.save(draft()), /未确认/)
  const failed = createVideoSavedAssetClient({
    fetcher: async () => response({}, { ok: false, status: 500 }),
  })
  await assert.rejects(failed.save(draft()))
  const controller = new AbortController()
  let calls = 0
  const aborted = createVideoSavedAssetClient({
    fetcher: async () => {
      calls++
      return response(saved())
    },
  })
  controller.abort()
  await assert.rejects(aborted.save(draft(), { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 0)
  const late = new AbortController()
  const lateClient = createVideoSavedAssetClient({
    fetcher: async () => {
      late.abort()
      return response([saved()])
    },
  })
  await assert.rejects(lateClient.list({ signal: late.signal }), { name: 'AbortError' })
})
