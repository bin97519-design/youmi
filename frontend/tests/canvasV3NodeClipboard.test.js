import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NODE_CLIPBOARD_FORMAT,
  NODE_CLIPBOARD_VERSION,
  NODE_CLIPBOARD_LIMITS,
  createNodeClipboard,
  serializeNodeClipboard,
  parseNodeClipboard,
  sanitizeCopiedNodeData,
  isNodeClipboardCopyBlocked,
} from '../src/features/canvas-v3/config/nodeClipboard.js'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII='
const node = (id = 'node-a', data = {}) => ({
  id,
  type: 'generator',
  position: { x: 140.5, y: -200.25 },
  selected: true,
  data: {
    kind: 'image',
    title: '参考图',
    prompt: '保留产品结构',
    model: 'model-api-key:4',
    params: { ratio: '3:4', resolution: '4K' },
    assetUrl: png,
    rating: 4,
    ...data,
  },
})
const edge = (id, source, target) => ({
  id,
  source,
  target,
  sourceHandle: 'output',
  targetHandle: 'input',
  type: 'default',
  data: { semantic: 'dependency' },
})
const encoded = (snapshot) => JSON.stringify(snapshot)

test('copy data retains visible settings and media, but never task ownership or authorization', () => {
  const source = node('source', {
    runState: 'succeeded',
    artifactStatus: 'failed',
    progress: 100,
    error: 'old failure',
    statusText: 'completed',
    consumedMi: 15,
    generation: { taskIds: ['paid-task'], clientTaskId: 'paid-client', results: ['old'] },
    client_task_id: 'top-level-key',
    directorRunId: 'director-id',
    directorDraftSignature: 'stale-signature',
    editDraft: { sourceId: 'old' },
    createdAt: 1,
    updatedAt: 2,
    params: {
      ratio: '3:4',
      version: 'flare',
      quality: 'max',
      client_task_id: 'nested-key',
      api_key: 'never-copy',
      nested: { taskIds: ['paid'] },
      director: { runId: 'stale-run', directorDraftSignature: 'old-draft' },
    },
    switches: { 联网搜索: true },
    stylePreset: { id: 'style', image: '/assets/style.webp', prompt: '保持风格' },
    editTemplate: {
      id: 'portrait-texture',
      sourceNodeId: 'source',
      settings: { skin: '自然肤质' },
    },
  })
  const before = structuredClone(source)
  const result = sanitizeCopiedNodeData(source.data)
  assert.equal(result.kind, 'image')
  assert.equal(result.model, 'model-api-key:4')
  assert.equal(result.title, '参考图')
  assert.equal(result.prompt, '保留产品结构')
  assert.equal(result.rating, 4)
  assert.equal(result.assetUrl, png)
  assert.equal(result.runState, 'idle')
  assert.equal(result.artifactStatus, 'ready')
  assert.deepEqual(result.params, {
    ratio: '3:4',
    version: 'flare',
    quality: 'max',
    nested: {},
    director: {},
  })
  assert.deepEqual(result.switches, { 联网搜索: true })
  assert.equal(result.stylePreset.image, '/assets/style.webp')
  assert.equal(result.editTemplate.settings.skin, '自然肤质')
  for (const key of [
    'generation',
    'client_task_id',
    'directorRunId',
    'directorDraftSignature',
    'editDraft',
    'progress',
    'error',
    'statusText',
    'consumedMi',
    'createdAt',
    'updatedAt',
  ])
    assert.equal(Object.hasOwn(result, key), false, key)
  assert.deepEqual(source, before)
  result.params.ratio = '1:1'
  assert.equal(source.data.params.ratio, '3:4')
})

test('blank drafts are idle and empty rather than completed jobs after copying', () => {
  const result = sanitizeCopiedNodeData({
    kind: 'text',
    title: '脚本',
    prompt: '正文',
    runState: 'succeeded',
  })
  assert.equal(result.artifactStatus, 'empty')
  assert.equal(result.runState, 'idle')
  assert.equal(Object.hasOwn(result, 'assetUrl'), false)
})

test('image and video task protections match graph active, paused and unresolved states', () => {
  for (const kind of ['image', 'video']) {
    for (const runState of [
      'preparing',
      'submitting',
      'queued',
      'running',
      'paused',
      'uncertain',
    ]) {
      const source = node('pending', { kind, runState })
      assert.equal(isNodeClipboardCopyBlocked(source), true)
      assert.throws(() => createNodeClipboard([source]), /不能复制/)
    }
    for (const generation of [
      { persistPending: true },
      { queryPending: true },
      { unresolvedTaskIds: ['pending-task'] },
    ]) {
      const source = node('pending', { kind, runState: 'succeeded', generation })
      assert.equal(isNodeClipboardCopyBlocked(source), true)
      assert.throws(() => createNodeClipboard([source]), /不能复制/)
    }
  }
  for (const runState of ['idle', 'succeeded', 'failed', 'cancelled'])
    assert.equal(isNodeClipboardCopyBlocked(node('done', { runState })), false)
  assert.equal(
    isNodeClipboardCopyBlocked(node('text', { kind: 'text', runState: 'running' })),
    false,
  )
})

test('explicit node lists preserve layout and only their internal edges and source references', () => {
  const first = node('first', {
    sourceImageNodeId: 'outside',
    localEdit: { operation: '裁剪', sourceNodeId: 'outside' },
  })
  const second = node('second', {
    sourceImageNodeId: 'first',
    editTemplate: { id: 'scene-sheet', sourceNodeId: 'first' },
  })
  second.selected = false // caller supplies the explicitly chosen list, not a selection predicate
  const result = createNodeClipboard(
    [first, second],
    [edge('inside', 'first', 'second'), edge('outside', 'other', 'first')],
  )
  assert.equal(result.format, NODE_CLIPBOARD_FORMAT)
  assert.equal(result.version, NODE_CLIPBOARD_VERSION)
  assert.deepEqual(
    result.nodes.map((value) => value.id),
    ['first', 'second'],
  )
  assert.deepEqual(result.nodes[0].position, first.position)
  assert.deepEqual(result.edges, [edge('inside', 'first', 'second')])
  assert.equal(result.nodes[0].data.sourceImageNodeId, undefined)
  assert.equal(result.nodes[0].data.localEdit.sourceNodeId, undefined)
  assert.equal(result.nodes[1].data.sourceImageNodeId, 'first')
  assert.equal(result.nodes[1].data.editTemplate.sourceNodeId, 'first')
  assert.equal(first.data.sourceImageNodeId, 'outside')
})

test('serialized clipboard round trips carry exact magic/version and isolated JSON values', () => {
  const snapshot = createNodeClipboard([node()])
  const text = serializeNodeClipboard(snapshot)
  assert.deepEqual(parseNodeClipboard(text), snapshot)
  assert.deepEqual(JSON.parse(text), snapshot)
  assert.notEqual(parseNodeClipboard(text), snapshot)
  assert.equal(Object.hasOwn(snapshot.nodes[0], 'selected'), false)
})

test('ordinary text, foreign versions, malformed JSON, external edges and extra envelope data are not node pastes', () => {
  const snapshot = createNodeClipboard([node()])
  for (const text of [
    '',
    'hello',
    '{',
    'null',
    '[]',
    'https://example.test/photo.png',
    encoded({ ...snapshot, format: 'another-app' }),
    encoded({ ...snapshot, version: 999 }),
    encoded({ ...snapshot, extra: 'unexpected' }),
    encoded({ ...snapshot, edges: [edge('external', 'node-a', 'other')] }),
  ])
    assert.equal(parseNodeClipboard(text), null, text.slice(0, 100))
  assert.throws(() => serializeNodeClipboard({ ...snapshot, format: 'foreign' }), /剪贴板/)
})

test('unsupported resource schemes, credentials, SVG and mismatched data media are rejected', () => {
  for (const assetUrl of [
    'javascript:alert(1)',
    'file:///C:/private.png',
    'blob:temporary',
    '//remote.test/a.png',
    'https://user:password@example.test/a.png',
    'https://example.test/a b.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,aGVsbG8=',
    '/api/private',
    '/src/%2e%2e/api/private',
    'data:audio/wav;base64,aGVsbG8=',
  ])
    assert.throws(() => createNodeClipboard([node('unsafe', { assetUrl })]), /地址|类型/)
  assert.throws(
    () => createNodeClipboard([node('unsafe', { stylePreset: { image: 'javascript:alert(1)' } })]),
    /地址/,
  )
  assert.throws(
    () => createNodeClipboard([node('unsafe', { params: { images: ['file:///private.jpg'] } })]),
    /地址/,
  )
  for (const assetUrl of [
    'https://cdn.example.test/photo.png?token=public-link',
    'http://127.0.0.1:5175/src/assets/test.webp',
    '/assets/test.webp',
    png,
  ])
    assert.equal(createNodeClipboard([node('safe', { assetUrl })]).nodes[0].data.assetUrl, assetUrl)
})

test('the whole batch is rejected for invalid node identities, kinds, coordinates, ratings or data shapes', () => {
  assert.throws(() => createNodeClipboard([]), /选择/)
  assert.throws(() => createNodeClipboard([node(), node()]), /重复/)
  for (const source of [
    { ...node(), id: '__proto__' },
    { ...node(), type: 'arbitrary-component' },
    { ...node(), position: { x: Infinity, y: 0 } },
    { ...node(), position: { x: 0, y: 1e12 } },
    node('bad-kind', { kind: 'script-injection' }),
    node('bad-rating', { rating: 6 }),
    node('bad-params', { params: ['not-an-object'] }),
    node('bad-number', { mediaWidth: NaN }),
  ])
    assert.throws(() => createNodeClipboard([node('first'), source]))
  assert.throws(
    () =>
      createNodeClipboard(
        Array.from({ length: NODE_CLIPBOARD_LIMITS.nodes + 1 }, (_, index) =>
          node(`node-${index}`),
        ),
      ),
    /100/,
  )
  assert.throws(
    () =>
      createNodeClipboard(
        [node('a'), node('b')],
        Array.from({ length: 501 }, (_, index) => edge(`edge-${index}`, 'a', 'b')),
      ),
    /500/,
  )
})

test('cycles, exotic objects, prototype keys and accessors never execute or enter the clipboard', () => {
  const cyclic = {}
  cyclic.self = cyclic
  for (const params of [
    cyclic,
    new Date(),
    { value: () => {} },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ])
    assert.throws(() => createNodeClipboard([node('bad', { params })]))
  let executed = false
  const getter = Object.defineProperty({}, 'secret', {
    enumerable: true,
    get() {
      executed = true
      return 'do not read'
    },
  })
  assert.throws(() => createNodeClipboard([node('bad', { params: getter })]))
  const array = [1]
  Object.defineProperty(array, '0', {
    get() {
      executed = true
      return 'do not read'
    },
  })
  assert.throws(() => createNodeClipboard([node('bad', { params: { values: array } })]))
  assert.equal(executed, false)
  const snapshot = createNodeClipboard([node()])
  const malicious = encoded(snapshot).replace(
    '"params":{',
    '"params":{"__proto__":{"polluted":true},',
  )
  assert.equal(parseNodeClipboard(malicious), null)
  assert.equal({}.polluted, undefined)
})

test('deep or giant clipboard payloads reject without changing the supplied graph nodes', () => {
  const source = node()
  let params = {}
  for (let index = 0; index < 20; index++) params = { nested: params }
  assert.throws(() => createNodeClipboard([node('deep', { params })]), /层级/)
  assert.throws(
    () => createNodeClipboard([node('large', { params: { values: Array(1001).fill(1) } })]),
    /数组|过大/,
  )
  assert.equal(parseNodeClipboard('x'.repeat(NODE_CLIPBOARD_LIMITS.text + 1)), null)
  assert.equal(source.data.runState, undefined)
  assert.equal(source.selected, true)
})

test('parsing cannot inject a pending task even with a valid format/version', () => {
  const snapshot = createNodeClipboard([node()])
  snapshot.nodes[0].data.generation = { queryPending: true, taskIds: ['foreign-task'] }
  assert.equal(parseNodeClipboard(encoded(snapshot)), null)
  delete snapshot.nodes[0].data.generation
  snapshot.nodes[0].data.runState = 'running'
  assert.equal(parseNodeClipboard(encoded(snapshot)), null)
})
