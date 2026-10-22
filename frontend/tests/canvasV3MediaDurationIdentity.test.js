import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { wanxiangReferenceState } from '../src/features/canvas-v3/config/wanxiangReferences.js'

let server, useGraph
before(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  ;({ useCanvasV3GraphStore: useGraph } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  ))
})
after(async () => server?.close())

function fixture(kind = 'video', extra = {}) {
  setActivePinia(createPinia())
  const graph = useGraph()
  graph.hydrate({
    projectId: 'media-duration-identity',
    nodes: [
      {
        id: 'source',
        type: 'generator',
        position: { x: 10, y: 20 },
        data: {
          kind,
          title: '素材',
          assetUrl: 'https://assets.example.com/old.mp4',
          mediaDuration: 5,
          durationSeconds: 5,
          mediaWidth: 1920,
          mediaHeight: 1080,
          prompt: '原提示词',
          params: { duration: 5, ratio: '16:9' },
          runState: 'succeeded',
          ...extra,
        },
      },
    ],
    edges: [],
  })
  return { graph, source: graph.nodes[0] }
}

test('replacing video URL invalidates old actual duration until the new media is measured', () => {
  const { graph, source } = fixture()
  assert.deepEqual(wanxiangReferenceState([source], { duration: '5' }).errors, [])
  const params = source.data.params
  const position = { ...source.position }
  graph.updateNodeData('source', { assetUrl: 'https://assets.example.com/new-20-seconds.mp4' })
  assert.equal(Object.hasOwn(source.data, 'mediaDuration'), false)
  assert.equal(Object.hasOwn(source.data, 'durationSeconds'), false)
  assert.match(wanxiangReferenceState([source], { duration: '5' }).error, /实际时长/)
  assert.equal(source.data.params, params)
  assert.deepEqual(source.position, position)
  assert.equal(source.data.mediaWidth, 1920)
  assert.equal(source.data.mediaHeight, 1080)
  assert.equal(graph.canUndo, false)
  assert.equal(graph.canRedo, false)
  graph.updateNodeData('source', { mediaDuration: 20 })
  assert.match(wanxiangReferenceState([source], { duration: '5' }).error, /视频总时长不能超过15秒/)
})

test('audio URL changes invalidate both duration spellings, including alias-only historical data', () => {
  const { graph, source } = fixture('audio', { mediaDuration: undefined, durationSeconds: 5 })
  assert.deepEqual(wanxiangReferenceState([source]).errors, [])
  graph.updateNodeData('source', { assetUrl: 'https://assets.example.com/new.mp3' })
  assert.equal(Object.hasOwn(source.data, 'mediaDuration'), false)
  assert.equal(Object.hasOwn(source.data, 'durationSeconds'), false)
  assert.match(wanxiangReferenceState([source]).error, /实际时长/)
})

test('same URL, prompt edits and task-state updates preserve actual duration and parameters', () => {
  const { graph, source } = fixture()
  graph.updateNodeData('source', { assetUrl: source.data.assetUrl })
  graph.updateNodeData('source', { prompt: '修改描述', runState: 'running', progress: 45 })
  assert.equal(source.data.mediaDuration, 5)
  assert.equal(source.data.durationSeconds, 5)
  assert.deepEqual(source.data.params, { duration: 5, ratio: '16:9' })
  assert.deepEqual(wanxiangReferenceState([source], { duration: '25' }).errors, [])
  assert.equal(graph.canUndo, false)
})

test('a URL replacement with explicit newly measured duration keeps only the supplied fresh values', () => {
  for (const metadata of [
    { mediaDuration: 8 },
    { durationSeconds: 8 },
    { mediaDuration: 8, durationSeconds: 8 },
  ]) {
    const { graph, source } = fixture()
    graph.updateNodeData('source', {
      assetUrl: 'https://assets.example.com/fresh.mp4',
      ...metadata,
    })
    for (const key of ['mediaDuration', 'durationSeconds']) {
      assert.equal(Object.hasOwn(source.data, key), Object.hasOwn(metadata, key))
      if (Object.hasOwn(metadata, key)) assert.equal(source.data[key], 8)
    }
    assert.equal(wanxiangReferenceState([source], { duration: '22' }).videoDurationSeconds, 8)
    assert.deepEqual(wanxiangReferenceState([source], { duration: '22' }).errors, [])
  }
})

test('removing a video asset clears its old duration, while image URL changes remain untouched', () => {
  const { graph, source } = fixture()
  graph.updateNodeData('source', { assetUrl: '' })
  assert.equal(Object.hasOwn(source.data, 'mediaDuration'), false)
  assert.equal(Object.hasOwn(source.data, 'durationSeconds'), false)
  const image = fixture('image')
  image.graph.updateNodeData('source', { assetUrl: 'https://assets.example.com/new.png' })
  assert.equal(image.source.data.mediaDuration, 5)
  assert.equal(image.source.data.durationSeconds, 5)
  assert.equal(image.source.data.mediaWidth, 1920)
  assert.equal(image.source.data.mediaHeight, 1080)
})
