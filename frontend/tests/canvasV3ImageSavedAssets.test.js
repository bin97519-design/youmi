import test from 'node:test'
import assert from 'node:assert/strict'
import {
  imageAssetCollectionKey,
  imageAssetFolderPath,
  imageAssetSourceUrl,
  loadImageAssetCollections,
  normalizeImageAssetCollections,
  saveImageAssetCollections,
} from '../src/features/canvas-v3/config/imageAssetCollections.js'
import { personalAssetKind } from '../src/features/canvas-v3/config/personalAssetLibrary.js'
import {
  createImageSavedAssetClient,
  imageSavedAssetPayload,
} from '../src/features/canvas-v3/sync/imageSavedAssetClient.js'

const imageUrl = 'https://assets.example.com/reference.png'
const draft = () => ({
  name: '参考图片',
  imageUrl,
  folderId: 'uncategorized',
  folderPath: ['待分类资产'],
  tags: ['角色'],
  sourceNodeId: 'node-1',
  width: 1280,
  height: 720,
})
const response = (data, extra = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 0, data }),
  ...extra,
})

test('saved images explicitly opt out of model, product and scene libraries', () => {
  assert.equal(personalAssetKind({ config: { libraryKind: 'asset' } }), 'asset')
  assert.equal(personalAssetKind({ config: { libraryKind: 'unknown' } }), 'model')
  assert.equal(personalAssetKind({ config: {} }), 'model')
})

test('image source checks allow safe permanent URLs and raster data only', () => {
  for (const url of [
    'javascript:alert(1)',
    'file:///a.png',
    'blob:https://example.com/id',
    'https://u:p@example.com/x.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,!?',
  ])
    assert.equal(imageAssetSourceUrl(url), '', url)
  assert.equal(imageAssetSourceUrl(imageUrl), imageUrl)
  assert.equal(imageAssetSourceUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
})

test('collection reads do not write, defaults are independent, and storage is strictly user-scoped', () => {
  const data = new Map(),
    writes = []
  const storage = {
    getItem: (key) => data.get(key),
    setItem: (key, value) => {
      writes.push(key)
      data.set(key, value)
    },
  }
  const initial = loadImageAssetCollections(storage, 'alice')
  assert.deepEqual(initial.folders, [{ id: 'uncategorized', name: '待分类资产', parentId: '' }])
  assert.deepEqual(initial.tags, ['角色', '场景', '物品', '风格', '音效'])
  assert.equal(writes.length, 0)
  initial.tags.push('我的标签')
  saveImageAssetCollections(storage, 'alice', initial)
  assert.ok(loadImageAssetCollections(storage, 'alice').tags.includes('我的标签'))
  assert.equal(loadImageAssetCollections(storage, 'bob').tags.includes('我的标签'), false)
  assert.equal(imageAssetCollectionKey(''), '')
  assert.throws(() => saveImageAssetCollections(storage, '', initial), /登录/)
})

test('malformed collection storage cannot introduce cyclic or duplicate folder rows', () => {
  const normalized = normalizeImageAssetCollections({
    folders: [
      { id: 'child', name: '子目录', parentId: 'parent' },
      { id: 'parent', name: '作品集', parentId: '' },
      { id: 'parent', name: '重复目录', parentId: '' },
      { id: 'loop', name: '循环', parentId: 'loop' },
      { id: 'missing', name: '孤立', parentId: 'nonexistent' },
    ],
    tags: ['角色', '新标签', '新标签', null],
  })
  assert.deepEqual(imageAssetFolderPath(normalized.folders, 'child'), ['作品集', '子目录'])
  assert.equal(normalized.folders.length, 3)
  assert.equal(normalized.tags.filter((tag) => tag === '新标签').length, 1)
  assert.equal(
    loadImageAssetCollections({ getItem: () => 'broken json' }, 'alice').folders.length,
    1,
  )
  assert.throws(
    () =>
      saveImageAssetCollections(
        {
          setItem: () => {
            throw new Error()
          },
        },
        'alice',
        {},
      ),
    /存储权限/,
  )
})

test('save calls actual personal material endpoint with auth and whitelisted metadata only', async () => {
  const calls = []
  const client = createImageSavedAssetClient({
    path: (path) => `/proxy${path}`,
    headers: () => ({ Authorization: 'Bearer account-token' }),
    fetcher: async (url, options) => {
      calls.push([url, options])
      return response({ ...JSON.parse(options.body), id: 'saved-1' })
    },
  })
  const source = {
    ...draft(),
    config: { secret: 'not copied' },
    generation: { taskId: 'not copied' },
  }
  const before = JSON.stringify(source)
  const saved = await client.save(source)
  assert.equal(saved.id, 'saved-1')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/proxy/api/canvas/characters')
  assert.equal(calls[0][1].method, 'POST')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer account-token')
  const body = JSON.parse(calls[0][1].body)
  assert.equal(body.imageUrl, imageUrl)
  assert.deepEqual(body.config, {
    libraryKind: 'asset',
    canvasAsset: {
      folderId: 'uncategorized',
      folderPath: ['待分类资产'],
      tags: ['角色'],
      sourceNodeId: 'node-1',
      width: 1280,
      height: 720,
    },
  })
  assert.equal(JSON.stringify(body).includes('not copied'), false)
  assert.equal(JSON.stringify(source), before)
})

test('invalid name, source and directory never upload or call the backend', async () => {
  let calls = 0
  const client = createImageSavedAssetClient({
    fetcher: async () => {
      calls++
      return response({})
    },
    uploadImage: async () => {
      calls++
      return imageUrl
    },
  })
  for (const extra of [
    { imageUrl: 'javascript:alert(1)' },
    { name: '' },
    { name: 'x'.repeat(51) },
    { folderId: '' },
    { folderPath: [] },
  ])
    await assert.rejects(client.save({ ...draft(), ...extra }))
  assert.equal(calls, 0)
})

test('raster images upload on explicit save before the backend receives a durable URL', async () => {
  const calls = [],
    controller = new AbortController()
  const client = createImageSavedAssetClient({
    uploadImage: async (source, options) => {
      calls.push(['upload', source, options])
      return imageUrl
    },
    fetcher: async (url, options) => {
      calls.push(['save', url, options])
      return response({ ...JSON.parse(options.body), id: 'saved' })
    },
  })
  await client.save(
    { ...draft(), imageUrl: 'data:image/png;base64,AAAA' },
    { signal: controller.signal },
  )
  assert.deepEqual(
    calls.map(([type]) => type),
    ['upload', 'save'],
  )
  assert.equal(calls[0][2].signal, controller.signal)
  assert.equal(JSON.parse(calls[1][2].body).imageUrl, imageUrl)
})

test('failed uploads, backend errors, malformed confirmations and aborts never claim success', async () => {
  const failing = createImageSavedAssetClient({
    fetcher: async () => response({}, { ok: false, status: 500 }),
  })
  await assert.rejects(failing.save(draft()))
  const malformed = createImageSavedAssetClient({
    fetcher: async () => response({ id: 'id', name: 'missing metadata' }),
  })
  await assert.rejects(malformed.save(draft()), /未确认/)
  let calls = 0
  const uploadFail = createImageSavedAssetClient({
    uploadImage: async () => {
      throw new Error('上传失败')
    },
    fetcher: async () => {
      calls++
      return response({})
    },
  })
  await assert.rejects(
    uploadFail.save({ ...draft(), imageUrl: 'data:image/png;base64,AAAA' }),
    /上传失败/,
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(uploadFail.save(draft(), { signal: controller.signal }), {
    name: 'AbortError',
  })
  assert.equal(calls, 0)
})

test('list fetches cloud records but excludes all legacy and typed material libraries', async () => {
  const client = createImageSavedAssetClient({
    fetcher: async (url, options) => {
      assert.equal(url, '/api/canvas/characters')
      assert.equal(options.method, 'GET')
      return response([
        { id: '1', name: '通用资产', imageUrl, config: { libraryKind: 'asset' } },
        { id: '2', name: '模特', imageUrl, config: {} },
        { id: '3', name: '商品', imageUrl, config: { libraryKind: 'product' } },
        {
          id: '4',
          name: '无效图片',
          imageUrl: 'javascript:alert(1)',
          config: { libraryKind: 'asset' },
        },
      ])
    },
  })
  assert.deepEqual(
    (await client.list()).map((record) => record.id),
    ['1'],
  )
  assert.equal(
    imageSavedAssetPayload({ ...draft(), width: -1, height: Infinity }).config.canvasAsset.width,
    undefined,
  )
})
