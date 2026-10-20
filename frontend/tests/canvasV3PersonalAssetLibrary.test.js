import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PERSONAL_ASSET_LIBRARIES,
  PRODUCT_ASSET_CATEGORIES,
  PRODUCT_ASSET_CATEGORY_FILTERS,
  personalAssetImageUrl,
  personalAssetKind,
  personalAssetLibrary,
  personalProductCategory,
} from '../src/features/canvas-v3/config/personalAssetLibrary.js'
import { createPersonalAssetLibraryClient } from '../src/features/canvas-v3/sync/personalAssetLibraryClient.js'

const row = (kind, changes = {}) => ({
  id: `${kind}-1`,
  name: `${kind}素材`,
  description: '已保存的素材说明',
  imageUrl: `https://assets.example.com/${kind}.png`,
  coverUrl: `https://assets.example.com/${kind}.png`,
  config: { ...(kind === 'model' ? {} : { libraryKind: kind }), notes: '自有备注' },
  ...changes,
})
const response = (data, { status = 200, code = 0, message = '' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ code, message, data }),
})

function harness(kind, handler) {
  const calls = []
  const client = createPersonalAssetLibraryClient({
    kind,
    path: (path) => `/proxy${path}`,
    headers: () => new Headers({ Authorization: 'Bearer test-account-session' }),
    fetcher: async (url, options) => {
      const call = { url, ...options }
      calls.push(call)
      if (handler) return handler(call)
      if (options.method === 'POST') {
        const payload = JSON.parse(options.body)
        return response({ ...payload, id: payload.id || `${kind}-new` })
      }
      if (options.method === 'DELETE')
        return response({ id: decodeURIComponent(url.split('/').at(-1)) })
      return response([row('model'), row('product'), row('scene')])
    },
  })
  return { client, calls }
}

test('metadata exposes only two personal libraries while legacy and unknown rows remain models', () => {
  assert.deepEqual(Object.keys(PERSONAL_ASSET_LIBRARIES), ['product', 'scene'])
  for (const [kind, label, singular] of [
    ['product', '我的商品库', '商品'],
    ['scene', '我的场景库', '场景'],
  ]) {
    const meta = personalAssetLibrary(kind)
    assert.equal(meta.kind, kind)
    assert.equal(meta.label, label)
    assert.equal(meta.title, label)
    assert.equal(meta.singular, singular)
    assert.ok(
      meta.uploadLabel &&
        meta.importTitle &&
        meta.importHint &&
        meta.emptyTitle &&
        meta.emptyDescription,
    )
    assert.ok(Object.isFrozen(meta))
    assert.equal(personalAssetKind(row(kind)), kind)
  }
  for (const record of [
    undefined,
    {},
    row('model'),
    { kind: 'product' },
    { config: null },
    { config: { libraryKind: 'Product' } },
    { config: { libraryKind: 'unknown' } },
    { config: Object.create({ libraryKind: 'scene' }) },
    { config: Object.assign([], { libraryKind: 'product' }) },
  ])
    assert.equal(personalAssetKind(record), 'model')
  for (const kind of ['model', 'unknown', '__proto__', null]) {
    assert.throws(() => personalAssetLibrary(kind), /商品库或场景库/)
    assert.throws(() => createPersonalAssetLibraryClient({ kind }), /商品库或场景库/)
  }
  assert.ok(Object.isFrozen(PERSONAL_ASSET_LIBRARIES))
})

test('product categories are explicit frozen metadata and unclassified exists only as a filter', () => {
  assert.deepEqual(PRODUCT_ASSET_CATEGORIES, ['窗帘', '床垫', '实木床', '儿童床', '床品', '其他'])
  assert.deepEqual(PRODUCT_ASSET_CATEGORY_FILTERS, [...PRODUCT_ASSET_CATEGORIES, '未分类'])
  assert.ok(Object.isFrozen(PRODUCT_ASSET_CATEGORIES))
  assert.ok(Object.isFrozen(PRODUCT_ASSET_CATEGORY_FILTERS))
  assert.equal(PRODUCT_ASSET_CATEGORIES.includes('未分类'), false)
  for (const productCategory of PRODUCT_ASSET_CATEGORIES) {
    const record = Object.freeze({
      config: Object.freeze({ libraryKind: 'product', productCategory }),
    })
    assert.equal(personalProductCategory(record), productCategory)
  }
})

test('category lookup never infers from names or images, opts drafts in, normalizes or mutates metadata', () => {
  const records = [
    undefined,
    {},
    row('product', { name: '云汀床垫', imageUrl: 'https://assets.example.com/床垫.png' }),
    { name: '床垫', config: { productCategory: '床垫' } },
    ...['model', 'scene'].map((kind) =>
      row(kind, { config: { libraryKind: kind, productCategory: '床垫' } }),
    ),
    ...[null, '', '未分类', '家具', ' 床垫 ', 'MATTRESS', ['床垫'], 1, true, {}].map(
      (productCategory) => row('product', { config: { libraryKind: 'product', productCategory } }),
    ),
    row('product', { config: { libraryKind: 'product', category: '床垫' } }),
  ]
  const before = structuredClone(records)
  for (const record of records) assert.equal(personalProductCategory(record), '')
  assert.deepEqual(records, before)
  assert.equal(
    personalProductCategory({
      config: Object.assign(Object.create({ productCategory: '床垫' }), {
        libraryKind: 'product',
      }),
    }),
    '',
  )
})

test('explicit new product categories survive the JSON save and list roundtrip without changing input', async () => {
  const stored = []
  const { client, calls } = harness('product', (call) => {
    if (call.method === 'POST') {
      const record = { ...JSON.parse(call.body), id: `product-${stored.length + 1}` }
      stored.push(record)
      return response(structuredClone(record))
    }
    return response(structuredClone(stored))
  })
  for (const productCategory of PRODUCT_ASSET_CATEGORIES) {
    const draft = {
      name: `${productCategory}资料`,
      imageUrl: 'https://assets.example.com/product.png',
      config: { productCategory, stock: { sku: 'owned-001', custom: ['原有属性'] } },
    }
    const before = structuredClone(draft)
    assert.equal(personalProductCategory(draft), '', 'untyped drafts never opt themselves in')
    const saved = await client.save(draft)
    assert.equal(saved.config.productCategory, productCategory)
    assert.equal(personalProductCategory(saved), productCategory)
    assert.deepEqual(saved.config, { ...draft.config, libraryKind: 'product' })
    assert.deepEqual(draft, before)
  }
  const listed = await client.list()
  assert.deepEqual(listed.map(personalProductCategory), PRODUCT_ASSET_CATEGORIES)
  assert.equal(calls.length, PRODUCT_ASSET_CATEGORIES.length + 1)
  for (const [index, call] of calls.slice(0, -1).entries()) {
    const payload = JSON.parse(call.body)
    assert.equal(payload.config.productCategory, PRODUCT_ASSET_CATEGORIES[index])
    assert.equal(typeof payload.config.productCategory, 'string')
    assert.equal(payload.config.libraryKind, 'product')
  }
})

test('legacy unknown categories stay unclassified and are preserved as inert metadata, including scenes', async () => {
  for (const productCategory of [undefined, null, '旧业务分类', ['床垫'], '未分类']) {
    const config = {
      libraryKind: 'product',
      ...(productCategory === undefined ? {} : { productCategory }),
      legacyData: { category: '床垫', custom: '保留，不迁移' },
    }
    const record = row('product', { name: '云汀床垫', config })
    const before = structuredClone(record)
    const { client, calls } = harness('product')
    const saved = await client.save(record)
    assert.deepEqual(JSON.parse(calls[0].body).config, config)
    assert.deepEqual(saved.config, config)
    assert.equal(personalProductCategory(saved), '')
    assert.deepEqual(record, before)
  }
  const scene = row('scene', {
    config: { libraryKind: 'scene', productCategory: '床垫', category: '卧室' },
  })
  const before = structuredClone(scene)
  const { client, calls } = harness('scene')
  const saved = await client.save(scene)
  assert.deepEqual(JSON.parse(calls[0].body).config, scene.config)
  assert.deepEqual(saved.config, scene.config)
  assert.equal(personalProductCategory(saved), '')
  assert.deepEqual(scene, before)
})

test('lists use the real authenticated account endpoint and strictly isolate all three kinds', async () => {
  const records = [
    row('model'),
    row('product'),
    row('scene'),
    {
      id: 'legacy-no-config',
      name: '旧模特',
      imageUrl: 'https://assets.example.com/legacy-model.png',
    },
  ]
  const before = structuredClone(records)
  const controller = new AbortController()
  for (const kind of ['product', 'scene']) {
    const { client, calls } = harness(kind, () => response(records))
    const listed = await client.list({ signal: controller.signal })
    assert.deepEqual(
      listed,
      records.filter((record) => personalAssetKind(record) === kind),
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/proxy/api/canvas/characters')
    assert.equal(calls[0].method, 'GET')
    assert.equal(calls[0].headers.authorization, 'Bearer test-account-session')
    assert.equal(calls[0].signal, controller.signal)
  }
  assert.deepEqual(records, before)
})

test('new saves construct typed API-compatible payloads and preserve owned inert metadata without mutating input', async () => {
  const { client, calls } = harness('product')
  const controller = new AbortController()
  const input = {
    name: '  绵绵岛床垫  ',
    description: '  产品外观参考  ',
    imageUrl: ' https://assets.example.com/mattress.png ',
    previewUrl: '/display-only.png',
    official: true,
    generation: { clientTaskId: 'top-level-job' },
    consumedMi: 9,
    config: {
      libraryKind: 'scene',
      sku: 'MIAN-001',
      price: 899,
      cost: 250,
      material: { name: '针织面料', colors: ['白色', '黑色包边'], customField: '保留资料' },
      generation: { clientTaskId: 'paid-job', taskIds: ['provider-task'] },
      billing: { logId: 100 },
      credentials: { apiKey: 'must-not-copy' },
      consumedMi: 5,
      measurements: { width: 180, client_task_id: 'nested-job', task_id: 'nested-provider-task' },
      attachments: [
        { url: 'https://assets.example.com/detail.png', note: '细节参考', taskIds: ['stale'] },
      ],
    },
  }
  const before = structuredClone(input)
  const result = await client.save(input, { signal: controller.signal })
  assert.equal(result.id, 'product-new')
  assert.equal(personalAssetKind(result), 'product')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/proxy/api/canvas/characters')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].signal, controller.signal)
  assert.equal(calls[0].headers.authorization, 'Bearer test-account-session')
  const payload = JSON.parse(calls[0].body)
  assert.deepEqual(
    Object.keys(payload).sort(),
    [
      'name',
      'description',
      'gender',
      'ageGroup',
      'culture',
      'imageUrl',
      'coverUrl',
      'config',
    ].sort(),
  )
  assert.equal(payload.name, '绵绵岛床垫')
  assert.equal(payload.imageUrl, 'https://assets.example.com/mattress.png')
  assert.equal(payload.coverUrl, payload.imageUrl)
  assert.equal(payload.gender, '')
  assert.equal(payload.ageGroup, '')
  assert.equal(payload.culture, '')
  assert.deepEqual(payload.config, {
    libraryKind: 'product',
    sku: 'MIAN-001',
    price: 899,
    cost: 250,
    material: input.config.material,
    measurements: { width: 180 },
    attachments: [{ url: 'https://assets.example.com/detail.png', note: '细节参考' }],
  })
  assert.deepEqual(input, before)
})

test('updates retain their real id and metadata and reject cross-kind or legacy model records before fetching', async () => {
  const { client, calls } = harness('scene')
  const existing = row('scene', {
    name: '奶油风卧室',
    config: { libraryKind: 'scene', room: '卧室', lighting: { source: '左侧自然光' } },
  })
  const before = structuredClone(existing)
  const result = await client.save(existing)
  assert.equal(result.id, existing.id)
  assert.deepEqual(JSON.parse(calls[0].body).config, existing.config)
  assert.deepEqual(existing, before)
  for (const record of [
    row('model'),
    row('product'),
    row('model', { config: { libraryKind: 'unknown' } }),
  ]) {
    await assert.rejects(client.save(record), /其他素材库/)
  }
  assert.equal(calls.length, 1, 'rejected updates must never reach POST')
})

test('safe image validation excludes ephemeral, credentialed, malformed and control-character sources', async () => {
  for (const url of [
    'https://assets.example.com/image.png?token=public-signed-image',
    'http://localhost:8083/uploaded/image.jpg',
  ])
    assert.equal(personalAssetImageUrl(` ${url} `), url)
  const invalid = [
    '',
    'data:image/png;base64,a',
    'blob:https://assets.example.com/image',
    '/uploaded/image.png',
    'javascript:alert(1)',
    'ftp://assets.example.com/image.png',
    'https://user:pass@example.com/image.png',
    'https://example.com/with space.png',
    'https://example.com/line\nbreak.png',
    'https:\\example.com/image.png',
    'https://',
    'https://example.com/' + 'a'.repeat(4096),
  ]
  const { client, calls } = harness('product')
  for (const imageUrl of invalid) {
    assert.equal(personalAssetImageUrl(imageUrl), '')
    await assert.rejects(client.save({ name: '商品', imageUrl }), /图片/)
  }
  await assert.rejects(
    client.save({
      name: '商品',
      imageUrl: row('product').imageUrl,
      coverUrl: 'javascript:alert(1)',
    }),
    /封面/,
  )
  assert.equal(calls.length, 0)
  const result = await client.save({ name: '仅封面素材', coverUrl: row('product').imageUrl })
  assert.equal(result.imageUrl, row('product').imageUrl)
})

test('save requires meaningful name, bounded metadata and valid identity without any write on validation failure', async () => {
  const { client, calls } = harness('scene')
  const imageUrl = row('scene').imageUrl
  for (const record of [
    { name: '', imageUrl },
    { name: ' '.repeat(4), imageUrl },
    { name: 'a'.repeat(81), imageUrl },
    { name: '卧室\0', imageUrl },
    { name: '卧室', description: 'a'.repeat(4001), imageUrl },
    { name: '卧室', imageUrl, config: [] },
    { name: '卧室', imageUrl, config: { notes: 'a'.repeat(65536) } },
    row('scene', { id: '../model-1' }),
    row('scene', { id: 'official-003' }),
    row('scene', { id: 'a'.repeat(81) }),
  ])
    await assert.rejects(client.save(record))
  const cycle = {}
  cycle.self = cycle
  await assert.rejects(client.save({ name: '卧室', imageUrl, config: cycle }), /有效 JSON/)
  assert.equal(calls.length, 0)
})

test('delete requires a complete typed saved record and preserves the real authenticated endpoint and signal', async () => {
  const { client, calls } = harness('product')
  const controller = new AbortController()
  const selected = row('product')
  const before = structuredClone(selected)
  for (const record of [
    selected.id,
    {},
    row('model'),
    row('scene'),
    row('product', { id: '' }),
    row('product', { id: '../escape' }),
  ]) {
    await assert.rejects(client.remove(record))
  }
  assert.equal(calls.length, 0)
  assert.deepEqual(await client.remove(selected, { signal: controller.signal }), {
    id: selected.id,
  })
  assert.equal(calls[0].method, 'DELETE')
  assert.equal(calls[0].url, '/proxy/api/canvas/characters/product-1')
  assert.equal(calls[0].headers.authorization, 'Bearer test-account-session')
  assert.equal(calls[0].signal, controller.signal)
  assert.deepEqual(selected, before)
})

test('wrong-kind or malformed successful save responses cannot masquerade as a saved item', async () => {
  for (const data of [
    row('model'),
    row('scene'),
    row('product', { imageUrl: 'data:image/png,x', coverUrl: '' }),
    {},
  ]) {
    const { client } = harness('product', () => response(data))
    await assert.rejects(client.save({ name: '商品', imageUrl: row('product').imageUrl }), /商品/)
  }
})

test('API errors use the current collection wording and retain status and code without mutating the original failure', async () => {
  for (const kind of ['product', 'scene']) {
    const singular = PERSONAL_ASSET_LIBRARIES[kind].singular
    const { client } = harness(kind, () =>
      response(null, { status: 403, code: 40302, message: '角色不存在或无权修改' }),
    )
    await assert.rejects(client.list(), (error) => {
      assert.equal(error.status, 403)
      assert.equal(error.code, 40302)
      assert.equal(error.message, `${singular}不存在或无权修改`)
      assert.doesNotMatch(error.message, /角色|模特/)
      return true
    })
    const malformed = harness(kind, () => response({ not: 'an array' }))
    await assert.rejects(malformed.client.list(), new RegExp(`${singular}库列表格式无效`))
  }
  const original = Object.assign(new Error('模特服务暂不可用'), {
    status: 503,
    code: 'upstream-down',
  })
  const { client } = harness('scene', async () => {
    throw original
  })
  await assert.rejects(client.list(), (error) => {
    assert.equal(error.message, '场景服务暂不可用')
    assert.equal(error.status, 503)
    assert.equal(error.code, 'upstream-down')
    assert.equal(error.cause, original)
    return true
  })
  assert.equal(original.message, '模特服务暂不可用')
})

test('abort remains an AbortError rather than a translated retry or a second request', async () => {
  const abort = new DOMException('The operation was aborted', 'AbortError')
  const { client, calls } = harness('product', async () => {
    throw abort
  })
  await assert.rejects(client.list(), (error) => error === abort)
  assert.equal(calls.length, 1)
})
