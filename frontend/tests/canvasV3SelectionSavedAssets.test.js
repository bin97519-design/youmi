import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SELECTION_ASSET_LIMIT,
  selectionAssetSnapshots,
  createSelectionSavedAssets,
} from '../src/features/canvas-v3/sync/selectionSavedAssets.js'

const image = (id = 'image', extra = {}) => ({
  id,
  data: {
    kind: 'image',
    title: `${id}.png`,
    assetUrl: `https://cdn.example.test/${id}.png`,
    ...extra,
  },
})
const video = (id = 'video', extra = {}) => ({
  id,
  data: {
    kind: 'video',
    title: `${id}.mp4`,
    assetUrl: `https://cdn.example.test/${id}.mp4`,
    ...extra,
  },
})
const details = { folderId: 'uncategorized', folderPath: ['待分类资产'], tags: ['角色'] }
const response = (body, id) => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 0, data: { ...JSON.parse(body), id } }),
})
const errorResponse = (status = 400) => ({
  ok: false,
  status,
  json: async () => ({ code: 123, message: '该项保存失败' }),
})

test('opening snapshots is read-only, bounded, deduplicated by node identity and drops secret/task fields', () => {
  const first = image('a', {
    generation: { key: 'never-copy' },
    params: { providerKey: 'never-copy' },
    mediaWidth: 1000,
    mediaHeight: 800,
  })
  const second = video('b', { posterUrl: 'https://cdn.example.test/poster.png', mediaDuration: 8 })
  const source = [
    first,
    first,
    { ...first },
    second,
    { id: 'text', data: { kind: 'text', prompt: 'not asset' } },
  ]
  const before = structuredClone(source)
  const snapshots = selectionAssetSnapshots(source)
  assert.equal(snapshots.length, 2)
  assert.equal(Object.isFrozen(snapshots), true)
  assert.equal(Object.isFrozen(snapshots[0]), true)
  assert.equal(snapshots[0].name, 'a')
  assert.equal(snapshots[0].width, 1000)
  assert.equal(snapshots[1].duration, 8)
  assert.equal(JSON.stringify(snapshots).includes('never-copy'), false)
  assert.deepEqual(source, before)
  first.data.assetUrl = 'https://cdn.example.test/changed.png'
  assert.equal(snapshots[0].sourceUrl, 'https://cdn.example.test/a.png')
  assert.equal(SELECTION_ASSET_LIMIT, 50)
  assert.throws(
    () => selectionAssetSnapshots(Array.from({ length: 51 }, (_, index) => image(String(index)))),
    /最多保存 50/,
  )
})

test('constructing client or batch never saves; explicit run uses real material API for both kinds', async () => {
  const calls = []
  const snapshots = selectionAssetSnapshots([image(), video('v', { mediaDuration: 9 })])
  const client = createSelectionSavedAssets({
    path: (path) => `/proxy${path}`,
    headers: () => ({ Authorization: 'Bearer mock-account' }),
    fetcher: async (url, init) => {
      calls.push([url, init])
      return response(init.body, `saved-${calls.length}`)
    },
  })
  const batch = client.createBatch(snapshots)
  assert.equal(calls.length, 0)
  assert.deepEqual(
    batch.state().map((row) => row.status),
    ['pending', 'pending'],
  )
  const updates = []
  const result = await batch.run(
    { ...details, names: { 'image:image': '新图片名称' } },
    { onProgress: (rows) => updates.push(rows) },
  )
  assert.equal(result.newlySaved.length, 2)
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ['saved', 'saved'],
  )
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], '/proxy/api/canvas/characters')
  assert.equal(calls[1][0], '/proxy/api/canvas/characters')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer mock-account')
  const savedImage = JSON.parse(calls[0][1].body)
  const savedVideo = JSON.parse(calls[1][1].body)
  assert.equal(savedImage.name, '新图片名称')
  assert.equal(savedImage.config.libraryKind, 'asset')
  assert.equal(savedVideo.config.mediaKind, 'video')
  assert.equal(savedVideo.config.videoUrl, snapshots[1].sourceUrl)
  assert.equal(savedVideo.imageUrl, '')
  assert.equal(updates.length, 4)
  assert.equal(updates[0][0].status, 'saving')
  assert.deepEqual((await batch.run(details)).newlySaved, [])
  assert.equal(calls.length, 2, 'A second save cannot duplicate confirmed rows')
})

test('data URL images upload only on Save and metadata is validated before an upload', async () => {
  const calls = []
  const client = createSelectionSavedAssets({
    uploadImage: async (source, request) => {
      calls.push(['upload', source, request])
      return 'https://cdn.example.test/uploaded.png'
    },
    fetcher: async (_url, init) => {
      calls.push(['save', init])
      return response(init.body, 'uploaded')
    },
  })
  const source = selectionAssetSnapshots([
    image('local', { assetUrl: 'data:image/png;base64,AAAA' }),
  ])
  const batch = client.createBatch(source)
  assert.equal(calls.length, 0)
  await assert.rejects(batch.run({ folderId: '', folderPath: [] }), /保存位置/)
  assert.equal(calls.length, 0)
  const invalid = await batch.run({ ...details, names: { 'image:local': '' } })
  assert.equal(invalid.failed.length, 1)
  assert.equal(calls.length, 0)
  const result = await batch.run({ ...details, names: { 'image:local': '有效名称' } })
  assert.equal(result.saved.length, 1)
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['upload', 'save'],
  )
  assert.equal(JSON.parse(calls[1][1].body).imageUrl, 'https://cdn.example.test/uploaded.png')
  assert.ok(calls[0][2].signal instanceof AbortSignal)
})

test('partial success is explicit and retries process only definite failures, never prior successes', async () => {
  const calls = []
  let rejectSecond = true
  const batch = createSelectionSavedAssets({
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body)
      calls.push(body.name)
      if (body.name === 'b' && rejectSecond) return errorResponse()
      return response(init.body, `saved-${body.name}`)
    },
  }).createBatch(selectionAssetSnapshots([image('a'), image('b'), video('c')]))
  const first = await batch.run(details)
  assert.deepEqual(
    first.rows.map((row) => row.status),
    ['saved', 'failed', 'saved'],
  )
  assert.equal(first.newlySaved.length, 2)
  assert.equal(first.failed.length, 1)
  rejectSecond = false
  const second = await batch.run(details)
  assert.deepEqual(calls, ['a', 'b', 'c', 'b'])
  assert.equal(second.saved.length, 3)
  assert.equal(second.newlySaved.length, 1)
})

test('cancel aborts the active request, stops queued items and never retries an uncertain POST', async () => {
  const calls = []
  let activeSignal
  const batch = createSelectionSavedAssets({
    fetcher: async (_url, init) => {
      calls.push(JSON.parse(init.body).name)
      activeSignal = init.signal
      await new Promise((_resolve, reject) =>
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        ),
      )
    },
  }).createBatch(selectionAssetSnapshots([image('a'), image('b')]))
  const promise = batch.run(details)
  await Promise.resolve()
  assert.equal(calls.length, 1)
  batch.cancel()
  const stopped = await promise
  assert.equal(activeSignal.aborted, true)
  assert.equal(stopped.cancelled, true)
  assert.deepEqual(
    stopped.rows.map((row) => row.status),
    ['uncertain', 'pending'],
  )
  assert.match(stopped.uncertain[0].error, /先到资产库核对.*不会自动重试/)
  const nextController = new AbortController()
  const retry = batch.run(details, { signal: nextController.signal })
  await Promise.resolve()
  nextController.abort()
  await retry
  assert.deepEqual(calls, ['a', 'b'], 'Uncertain first POST is not repeated')
})

test('cancel during local image upload does not POST and leaves that item pending', async () => {
  let posts = 0
  const batch = createSelectionSavedAssets({
    uploadImage: async (_source, request) =>
      new Promise((_resolve, reject) =>
        request.signal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        ),
      ),
    fetcher: async () => {
      posts++
      throw new Error('Must not POST after aborted upload')
    },
  }).createBatch(
    selectionAssetSnapshots([image('a', { assetUrl: 'data:image/png;base64,AAAA' }), image('b')]),
  )
  const promise = batch.run(details)
  await Promise.resolve()
  batch.cancel()
  const result = await promise
  assert.equal(posts, 0)
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ['pending', 'pending'],
  )
})

test('context switches stop queued writes, suppress late progress and never adopt new-account headers', async () => {
  let resolve
  let account = 'alice'
  let valid = true
  const calls = []
  const updates = []
  const batch = createSelectionSavedAssets({
    headers: () => ({ Authorization: account }),
    fetcher: async (_url, init) => {
      calls.push(init)
      return new Promise((done) => {
        resolve = () => done(response(init.body, 'late'))
      })
    },
  }).createBatch(selectionAssetSnapshots([image('a'), image('b')]))
  const promise = batch.run(details, {
    isCurrent: () => valid,
    onProgress: (rows) => updates.push(rows),
  })
  await Promise.resolve()
  assert.equal(calls.length, 1)
  valid = false
  account = 'bob'
  resolve()
  const result = await promise
  assert.equal(result.cancelled, true)
  assert.equal(result.newlySaved.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.Authorization, 'alice')
  assert.equal(updates.length, 1, 'No late completion or new-account progress is emitted')
})

test('unknown POST confirmations and transport failures stay uncertain instead of unsafe duplicate retries', async () => {
  for (const fetcher of [
    async () => {
      throw new TypeError('network failure')
    },
    async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: {} }) }),
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { id: 'wrong', name: 'wrong', imageUrl: '' } }),
    }),
  ]) {
    const batch = createSelectionSavedAssets({ fetcher }).createBatch(
      selectionAssetSnapshots([image()]),
    )
    const result = await batch.run(details)
    assert.equal(result.uncertain.length, 1)
    assert.equal(result.saved.length, 0)
    assert.equal((await batch.run(details)).newlySaved.length, 0)
  }
})

test('invalid media rows are visible and never saved while valid rows can complete independently', async () => {
  let calls = 0
  const batch = createSelectionSavedAssets({
    fetcher: async (_url, init) => {
      calls++
      return response(init.body, 'good')
    },
  }).createBatch(
    selectionAssetSnapshots([
      image('bad', { assetUrl: '' }),
      video('bad-video', { assetUrl: 'blob:temporary' }),
      image('good'),
    ]),
  )
  assert.deepEqual(
    batch.state().map((row) => row.status),
    ['invalid', 'invalid', 'pending'],
  )
  const result = await batch.run(details)
  assert.equal(result.failed.length, 2)
  assert.equal(result.saved.length, 1)
  assert.equal(calls, 1)
})
