import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import { hasDecodedVideoFrame, videoPlaybackResultPatch } from '../src/utils/videoPlayback.js'

test('audio-only metadata is not treated as a playable video frame', () => {
  assert.equal(hasDecodedVideoFrame({ videoWidth: 0, videoHeight: 0, duration: 25 }), false)
  assert.equal(hasDecodedVideoFrame({ videoWidth: 1440, videoHeight: 1920 }), true)
})

const result = {
  id: 'job-1',
  status: 'completed',
  url: 'https://example.test/playable.mp4',
  width: 1440,
  height: 1920,
  duration: 25.3,
}

test('playback repair keeps the original and corrects guessed dimensions', () => {
  const patch = videoPlaybackResultPatch(
    {
      url: 'https://example.test/original.mp4',
      width: 320,
      naturalWidth: 1920,
      naturalHeight: 1080,
    },
    result,
  )
  assert.equal(patch.originalVideoUrl, 'https://example.test/original.mp4')
  assert.equal(patch.url, result.url)
  assert.equal(patch.height, 427)
  assert.equal(patch.naturalWidth, 1440)
  assert.equal(patch.videoPlayback.status, 'completed')
})

test('known dimensions preserve a manually resized node', () => {
  const patch = videoPlaybackResultPatch(
    {
      url: 'https://example.test/old.mp4',
      originalVideoUrl: 'https://example.test/original.mp4',
      width: 320,
      height: 240,
      naturalWidth: 1440,
      naturalHeight: 1920,
    },
    result,
  )
  assert.equal(patch.originalVideoUrl, 'https://example.test/original.mp4')
  assert.equal(patch.height, undefined)
})

test('invalid conversion output cannot replace the original video', () => {
  for (const invalid of [
    { ...result, status: 'processing' },
    { ...result, width: 0 },
    { ...result, url: 'javascript:bad' },
  ])
    assert.throws(() => videoPlaybackResultPatch({ url: 'original' }, invalid), /原视频已保留/)
})

const require = createRequire(import.meta.url)
const { parse } = createRequire(require.resolve('@vue/compiler-sfc'))('@babel/parser')
const editor = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const node = parse(editor, { sourceType: 'module' }).program.body.find(
  (item) => item.type === 'FunctionDeclaration' && item.id?.name === 'repairCanvasVideoPlayback',
)

function repair(responses, beforeFetch = () => {}) {
  const layer = {
    id: 'node',
    url: 'https://example.test/original.mp4',
    width: 320,
    naturalWidth: 1920,
    naturalHeight: 1080,
  }
  const requests = [],
    revealed = [],
    flushes = []
  const props = { id: 'canvas' }
  const context = vm.createContext({
    props,
    _mounted: { value: true },
    layers: { value: [layer] },
    videoPlaybackRepairs: new Set(),
    attemptedVideoPlaybackRepairs: new Set(),
    videoPlaybackResultPatch,
    videoViewer: { show: true, url: layer.url },
    apiPath: (value) => value,
    loadVideoCapabilities: async () => ({ videoPlayback: true }),
    userStore: { authHeaders: () => ({}) },
    readApiResponse: async (value) => value,
    fetch: async (path, options) => {
      requests.push({ path, ...options })
      beforeFetch(requests.length, layer, props)
      const value = responses.shift()
      if (value instanceof Error) throw value
      assert.ok(value, 'unexpected extra conversion request')
      return value
    },
    updateLayer: (id, patch) => Object.assign(layer, patch),
    revealCanvasMedia: (id) => revealed.push(id),
    canvas: { flushNow: async (id) => flushes.push(id) },
    wait: async () => {},
  })
  vm.runInContext(editor.slice(node.start, node.end), context)
  return {
    context,
    layer,
    requests,
    revealed,
    flushes,
    run: (force) => context.repairCanvasVideoPlayback(layer, force),
  }
}

test('actual canvas repair converts once, reveals the result and updates an open viewer', async () => {
  const run = repair([{ id: 'job-1', status: 'processing' }, result])
  await run.run()
  assert.equal(run.requests.filter((item) => item.method === 'POST').length, 1)
  assert.equal(run.requests[1].path, '/api/video-playback/job-1')
  assert.equal(run.layer.url, result.url)
  assert.equal(run.context.videoViewer.url, result.url)
  assert.equal(run.layer.originalVideoUrl, 'https://example.test/original.mp4')
  assert.equal(run.layer.height, 427)
  assert.deepEqual(run.revealed, ['node'])
  assert.deepEqual(run.flushes, ['canvas'])
})

test('actual repair resumes a saved job instead of submitting another conversion', async () => {
  const run = repair([result])
  run.layer.videoPlayback = { sourceUrl: run.layer.url, id: 'job-1', status: 'processing' }
  await run.run()
  assert.equal(run.requests.length, 1)
  assert.equal(run.requests[0].path, '/api/video-playback/job-1')
  assert.equal(run.requests[0].method, undefined)
})

test('failed conversion keeps the original and only retries when explicitly requested', async () => {
  const run = repair([{ id: 'job-1', status: 'failed', error: 'test conversion error' }, result])
  await run.run()
  assert.equal(run.layer.videoPlayback.status, 'failed')
  assert.equal(run.layer.url, 'https://example.test/original.mp4')
  await run.run()
  assert.equal(run.requests.length, 1)
  await run.run(true)
  assert.equal(run.requests.length, 2)
  assert.equal(run.requests[1].method, 'POST')
  assert.equal(run.layer.url, result.url)
})

test('switching canvases cannot apply a conversion to another document', async () => {
  const run = repair([result], (count, layer, props) => {
    props.id = 'other-canvas'
  })
  await run.run()
  assert.equal(run.layer.url, 'https://example.test/original.mp4')
  assert.deepEqual(run.revealed, [])
  assert.deepEqual(run.flushes, [])
})

test('an older backend gives a clear unavailable state without discarding the original', async () => {
  const run = repair([{ status: 404 }])
  await run.run()
  assert.equal(run.layer.url, 'https://example.test/original.mp4')
  assert.equal(run.layer.videoPlayback.status, 'failed')
  assert.match(run.layer.videoPlayback.error, /兼容服务尚未启动/)
})

test('capability gating avoids submitting playback work to an older backend', async () => {
  const run = repair([])
  run.context.loadVideoCapabilities = async () => ({})
  await run.run()
  assert.equal(run.requests.length, 0)
  assert.equal(run.layer.url, 'https://example.test/original.mp4')
  assert.match(run.layer.videoPlayback.error, /兼容服务尚未启动/)
})

test('successfully decoded metadata clears an obsolete playback error', () => {
  const fn = parse(editor, { sourceType: 'module' }).program.body.find(item => item.type === 'FunctionDeclaration' && item.id?.name === 'syncVideoNodeMediaDimensions')
  const layer = { id: 'node', naturalWidth: 1440, videoPlayback: { status: 'failed', error: 'old network error' } }
  const context = vm.createContext({ hasDecodedVideoFrame, updateLayer: (id, patch) => Object.assign(layer, patch) })
  vm.runInContext(editor.slice(fn.start, fn.end), context)
  context.syncVideoNodeMediaDimensions(layer, { target: { videoWidth: 1440, videoHeight: 1920 } })
  assert.equal(layer.videoPlayback, null)
})
