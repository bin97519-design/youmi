import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

const ok = (data) => new Response(JSON.stringify({ code: 0, data }), { status: 200 })

async function setup(t, model, { delayModels = false } = {}) {
  const originalFetch = globalThis.fetch
  const posts = []
  let releaseModels
  const waiting = new Promise((resolve) => (releaseModels = resolve))
  const option = { value: 'model-api-key:test', model, label: model }
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/video-tasks/canvas-models'))
      return delayModels ? waiting : ok([option])
    if (String(url).endsWith('/api/image-tasks/canvas-models'))
      return ok({ mappingConfigured: true, options: [] })
    if (String(url).endsWith('/api/video-tasks') && options.method === 'POST') {
      posts.push(JSON.parse(options.body))
      return ok({ taskId: 'test-task-id', status: 'queued' })
    }
    throw new Error('Unexpected local mock URL: ' + url)
  }
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  const { useCanvasV3GraphStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  )
  const { useUserStore } = await server.ssrLoadModule('/src/stores/user.js')
  const { useCanvasV3TaskStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/tasks.js',
  )
  setActivePinia(createPinia())
  const graph = useCanvasV3GraphStore()
  graph.hydrate({ projectId: 'automatic-video-test', nodes: [], edges: [] })
  const user = useUserStore()
  user.isAuthenticated = true
  user.token = 'test-only-token'
  const node = graph.addNode('video')
  graph.updateNodeData(node.id, {
    model,
    mode: 'obsolete-manual-mode',
    prompt: '沿着光线推进',
    params: {
      ratio: '16:9',
      resolution: model === 'minimax-h3' ? '768P' : '720P',
      duration: 6,
      count: '4个',
    },
  })
  const tasks = useCanvasV3TaskStore()
  tasks.attach(graph.projectId)
  t.after(async () => {
    tasks.detach(graph.projectId)
    globalThis.fetch = originalFetch
    await server.close()
  })
  function add(
    kind,
    number,
    url = `https://example.test/${kind}-${number}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'}`,
  ) {
    const input = graph.addNode(kind)
    graph.updateNodeData(input.id, {
      assetUrl: url,
      mediaDuration: kind === 'video' ? 4 : undefined,
    })
    graph.connect({ source: input.id, target: node.id })
    return input
  }
  return { graph, tasks, node, posts, add, releaseModels: () => releaseModels(ok([option])) }
}

for (const model of ['minimax-h3', 'doubao-seedance-2-5-260628']) {
  for (const [label, imageCount, videoCount, audioCount, inferred] of [
    ['text', 0, 0, 0, 'text'],
    ['one image', 1, 0, 0, 'first-frame'],
    ['two images', 2, 0, 0, 'first-last'],
    ['three images', 3, 0, 0, 'reference-image'],
    ['two images and audio', 2, 0, 1, 'multimodal'],
    ['audio and video only', 0, 1, 1, 'multimodal'],
  ]) {
    test(`${model} store infers ${label} and persists actual request inputs without quantity`, async (t) => {
      const h = await setup(t, model)
      const images = Array.from({ length: imageCount }, (_, index) => h.add('image', index))
      for (let index = 0; index < videoCount; index++) h.add('video', index)
      for (let index = 0; index < audioCount; index++) h.add('audio', index)
      await h.tasks.runVideo(h.node.id)
      assert.equal(h.posts.length, 1, h.node.data.error)
      const body = h.posts[0]
      const generation = h.node.data.generation
      assert.equal(generation.inputMode, inferred)
      assert.equal(generation.params.count, undefined)
      assert.equal(body.count, undefined)
      assert.equal(body.n, undefined)
      assert.equal(generation.params.ratio, body.ratio === 'adaptive' ? 'Auto' : body.ratio)
      const frames = ['first-frame', 'first-last'].includes(inferred)
      assert.equal(body.first_frame_url, frames ? images[0].data.assetUrl : undefined)
      assert.equal(
        body.last_frame_url,
        frames && images.length === 2 ? images[1].data.assetUrl : undefined,
      )
      assert.equal(body.reference_image_urls.length, frames ? 0 : imageCount)
      assert.equal(body.reference_videos.length, videoCount)
      assert.equal(body.reference_audios.length, audioCount)
      assert.deepEqual(generation.inputs.referenceImageUrls, body.reference_image_urls)
      assert.deepEqual(generation.inputs.referenceVideos, body.reference_videos)
      assert.deepEqual(generation.inputs.referenceAudios, body.reference_audios)
      assert.equal(generation.inputs.firstFrameUrl, body.first_frame_url || '')
      assert.equal(generation.inputs.lastFrameUrl, body.last_frame_url || '')
    })
  }
}

test('two distinct nodes with the same picture remain separate first and last frames', async (t) => {
  const h = await setup(t, 'minimax-h3')
  h.add('image', 1, 'https://example.test/loop.png')
  h.add('image', 2, 'https://example.test/loop.png')
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts.length, 1, h.node.data.error)
  assert.equal(h.posts[0].first_frame_url, 'https://example.test/loop.png')
  assert.equal(h.posts[0].last_frame_url, 'https://example.test/loop.png')
  assert.equal(h.node.data.generation.inputMode, 'first-last')
})

test('mode, ordering and inputs are frozen before the asynchronous model lookup', async (t) => {
  const h = await setup(t, 'minimax-h3', { delayModels: true })
  const first = h.add('image', 1)
  const last = h.add('image', 2)
  const run = h.tasks.runVideo(h.node.id)
  h.graph.updateNodeData(first.id, { assetUrl: 'https://example.test/replaced.png' })
  h.add('audio', 3)
  h.node.data.mode = '参考生'
  h.releaseModels()
  await run
  assert.equal(h.posts.length, 1, h.node.data.error)
  assert.equal(h.posts[0].first_frame_url, 'https://example.test/image-1.png')
  assert.equal(h.posts[0].last_frame_url, last.data.assetUrl)
  assert.equal(h.posts[0].reference_audios.length, 0)
  assert.equal(h.node.data.generation.inputMode, 'first-last')
})

test('unfinished connected media is rejected before any paid POST rather than becoming text-to-video', async (t) => {
  const h = await setup(t, 'minimax-h3')
  h.add('audio', 0, '')
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts.length, 0)
  assert.equal(h.node.data.runState, 'failed')
  assert.match(h.node.data.error, /尚未就绪/)
})

test('Seedance two-image first/last generation preserves 9:16 while one-image first frame alone requires adaptive', async (t) => {
  const h = await setup(t, 'doubao-seedance-2-5-260628')
  h.graph.updateNodeData(h.node.id, { params: { ratio: '9:16', resolution: '720P', duration: 6 } })
  const first = h.add('image', 1)
  const last = h.add('image', 2)
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts.length, 1, h.node.data.error)
  assert.equal(h.posts[0].ratio, '9:16')
  assert.equal(h.posts[0].first_frame_url, first.data.assetUrl)
  assert.equal(h.posts[0].last_frame_url, last.data.assetUrl)
  assert.equal(h.node.data.generation.params.ratio, '9:16')
  assert.equal(h.node.data.generation.inputMode, 'first-last')
  const oneImageNode = h.graph.addNode('video')
  h.graph.updateNodeData(oneImageNode.id, {
    model: 'doubao-seedance-2-5-260628',
    prompt: '单图首帧',
    params: { ratio: '9:16', resolution: '720P', duration: 6 },
  })
  h.graph.connect({ source: first.id, target: oneImageNode.id })
  await h.tasks.runVideo(oneImageNode.id)
  assert.equal(h.posts.length, 2, oneImageNode.data.error)
  assert.equal(h.posts[1].ratio, 'adaptive')
  assert.equal(h.posts[1].last_frame_url, undefined)
  assert.equal(oneImageNode.data.generation.inputMode, 'first-frame')
})
