import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import { returnedVideoTaskUrl, videoTaskStatusText, taskState, videoGenerationPending,
  videoTaskPollDue, videoGenerationStatus, newProductVideoTask, newShot, productVideoTaskState } from '../src/utils/productVideo.js'
import { batchVideoState } from '../src/utils/productVideoBatch.js'

const require = createRequire(import.meta.url)
const { parse } = createRequire(require.resolve('@vue/compiler-sfc'))('@babel/parser')
const editor = parseVue(fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'))
  .descriptor.scriptSetup.content
const editorAst = parse(editor, { sourceType: 'module' }).program.body
const composable = fs.readFileSync(new URL('../src/composables/useProductVideo.js', import.meta.url), 'utf8')
const composableAst = parse(composable, { sourceType: 'module' }).program.body
  .find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'useProductVideo')
  .declaration.body.body

function functionSource(source, nodes, name) {
  const node = nodes.find(item => item.type === 'FunctionDeclaration' && item.id?.name === name)
  assert.ok(node, `Missing function ${name}`)
  return source.slice(node.start, node.end)
}

const url = 'https://assets.example/completed.mp4'
const pendingCost = { status: 'processing', progress: 100, stage: '生成已完成，等待灵科 AI 返回实际费用', videoUrls: [url] }

test('delivered media unlocks generation and completes a main video 2 task while its bill is still pending', () => {
  const entry = { id: 'delivered', taskId: 'original-task', status: 'processing', progress: 100, stage: pendingCost.stage, url, batchId: 'batch' }
  assert.equal(videoGenerationPending(entry), false)
  assert.equal(videoGenerationStatus(entry), '视频已完成 · 费用待结算')
  assert.equal(videoGenerationStatus({ ...entry, status: 'completed' }), '视频已完成')
  assert.match(videoGenerationStatus({ ...entry, pollError: '查询中断，自动重试' }), /视频已完成.*费用待结算.*查询中断/)
  assert.equal(videoGenerationPending({ ...entry, url: '' }), true)
  for (const status of ['submitting', 'unknown']) assert.equal(videoGenerationPending({ status, url: '' }), true)
  const task = newProductVideoTask(), shot = newShot({ productionMode: 'single_video' })
  task.planner = 'main_video_2'
  task.shots = [shot]; shot.videos = [entry]; shot.videoId = entry.id
  assert.equal(productVideoTaskState(task), 'completed')
  assert.equal(batchVideoState(shot, 'batch'), 'completed')
  shot.videos.push({ id: 'new-version', status: 'processing', url: '', batchId: 'new-batch' })
  assert.equal(shot.videos.some(videoGenerationPending), true)
  assert.equal(productVideoTaskState(task), 'generating')
  assert.equal(batchVideoState(shot, 'new-batch'), 'processing')
})

test('billing checks continue on the original task at a slower interval and stop after settlement', () => {
  const entry = { taskId: 'original-task', status: 'processing', url, lastSyncedAt: 100000 }
  assert.equal(videoTaskPollDue(entry, 105000), false)
  assert.equal(videoTaskPollDue(entry, 129999), false)
  assert.equal(videoTaskPollDue(entry, 130000), true)
  assert.equal(videoTaskPollDue({ ...entry, url: '' }, 105000), true)
  assert.equal(videoTaskPollDue({ ...entry, lastSyncedAt: undefined }, 105000), true)
  assert.equal(videoTaskPollDue({ ...entry, status: 'completed' }, 150000), false)
  assert.equal(videoTaskPollDue({ ...entry, status: 'failed' }, 150000), false)
})

test('the actual generation guard permits a new version after media arrives but still blocks unresolved submissions', async () => {
  for (const returned of [true, false]) {
    const shot = { id: 'shot', videos: [{ status: 'processing', url: returned ? url : '' }] }
    let validationEntered = 0
    const context = vm.createContext({
      getTask: () => ({ shots: [shot] }), uid: () => 'new-video-version', videoGenerationPending,
      availableImageModelOption: () => { validationEntered++; throw new Error('reached generation validation') },
      isCurrent: () => false,
    })
    vm.runInContext(functionSource(composable, composableAst, 'generate'), context)
    await context.generate('shot', 'video', {})
    assert.equal(validationEntered, returned ? 1 : 0)
  }
})

test('returned media is available during billing confirmation, but failures and progress alone are not results', () => {
  assert.equal(returnedVideoTaskUrl(pendingCost), url)
  assert.equal(videoTaskStatusText(pendingCost, 100), pendingCost.stage)
  for (const status of ['failed', 'cancelled', 'error'])
    assert.equal(returnedVideoTaskUrl({ ...pendingCost, status }), '')
  assert.equal(returnedVideoTaskUrl({ status: 'processing', progress: 100 }), '')
  assert.match(videoTaskStatusText({ status: 'processing' }, 100), /等待成片地址/)
  assert.equal(returnedVideoTaskUrl({ status: 'completed', video_urls: [' ', ` ${url} `] }), url)
})

function canvasPoll(responses, beforeFetch = () => {}) {
  const layer = { id: 'node', taskId: 'anmiao-video:key:9:task', generating: true, status: 'processing', url: '' }
  const chat = {}, delays = [], flushes = [], revealed = []
  let fetched = 0
  const context = vm.createContext({
    _mounted: { value: true }, layers: { value: [layer] },
    VIDEO_TASK_MAX_POLLS: 1, VIDEO_TASK_POLL_INTERVAL: 4000, VIDEO_BILLING_POLL_INTERVAL: 30000,
    returnedVideoTaskUrl, videoTaskStatusText, taskState,
    wait: async ms => { delays.push(ms) },
    fetchVideoTask: async () => {
      beforeFetch(fetched, layer, chat)
      const response = responses[fetched++]
      assert.ok(response, 'Polling should stop when the task is completed')
      if (response instanceof Error) throw response
      return response
    },
    updateLayer: (id, patch) => Object.assign(layer, patch),
    updateChatMessage: (id, patch) => Object.assign(chat, patch),
    revealCanvasMedia: id => { revealed.push(id) },
    canvas: { flushNow: async id => { flushes.push(id) } }, props: { id: 'canvas' },
  })
  vm.runInContext(functionSource(editor, editorAst, 'pollVideoTaskUntilDone'), context)
  return { layer, chat, delays, flushes, revealed, run: () => context.pollVideoTaskUntilDone('anmiao-video:key:9:task', 'node', 'message') }
}

test('actual canvas poll displays the video before settlement and keeps confirming the original task', async () => {
  const poll = canvasPoll([pendingCost, pendingCost, { ...pendingCost, status: 'completed' }], (index, layer, chat) => {
    if (index > 0) {
      assert.equal(layer.url, url)
      assert.equal(layer.generating, true)
      assert.equal(chat.videoUrl, url)
      assert.equal(chat.text, pendingCost.stage)
    }
  })
  assert.equal(await poll.run(), true)
  assert.equal(poll.layer.generating, false)
  assert.equal(poll.layer.status, 'completed')
  assert.deepEqual(poll.delays, [4000, 30000, 30000])
  assert.ok(poll.flushes.length >= 2)
  assert.deepEqual(poll.revealed, ['node'])
})

test('a billing query interruption does not discard or fail an already returned video', async () => {
  const poll = canvasPoll([pendingCost, new Error('network disconnected'), { ...pendingCost, status: 'completed' }])
  assert.equal(await poll.run(), true)
  assert.equal(poll.layer.url, url)
  assert.equal(poll.layer.status, 'completed')
})

test('terminal video status aliases finish polling without waiting for a literal completed status', async () => {
  for (const status of ['ready', 'generated', 'succeeded']) {
    const poll = canvasPoll([{ ...pendingCost, status }])
    assert.equal(await poll.run(), true)
    assert.equal(poll.layer.status, 'completed')
    assert.equal(poll.layer.url, url)
  }
})

test('100 percent without an address does not become a completed canvas video', async () => {
  const poll = canvasPoll([{ status: 'processing', progress: 100 }])
  await assert.rejects(poll.run(), /等待超时/)
  assert.equal(poll.layer.url, '')
  assert.equal(poll.layer.status, 'processing')
})

test('restored video tasks keep polling without revealing cached media over the collapsed canvas', () => {
  const revealed = [], polling = []
  const context = vm.createContext({
    layers: { value: [
      { id: 'returned', type: 'video', generating: true, taskId: 'original', url },
      { id: 'completed', type: 'video', generating: false, taskId: 'done', url },
      { id: 'waiting', type: 'video', generating: true, taskId: 'pending', url: '' },
    ] },
    pollingVideoTaskIds: new Set(),
    revealCanvasMedia: id => { revealed.push(id) },
    startVideoTaskPoll: async (taskId, layerId) => { polling.push([taskId, layerId]) },
    updateLayer: () => {},
  })
  vm.runInContext(functionSource(editor, editorAst, 'resumePendingVideoTasks'), context)
  context.resumePendingVideoTasks()
  assert.deepEqual(revealed, [])
  assert.deepEqual(polling, [['original', 'returned'], ['pending', 'waiting']])
})

test('polling a restored video keeps its media hidden through billing confirmation and completion', async () => {
  const poll = canvasPoll([pendingCost, pendingCost, { ...pendingCost, status: 'completed' }])
  poll.layer.url = url
  assert.equal(await poll.run(), true)
  assert.equal(poll.layer.url, url)
  assert.equal(poll.layer.generating, false)
  assert.deepEqual(poll.revealed, [])
  assert.deepEqual(poll.delays, [30000, 30000, 30000])
})

test('actual storyboard poll publishes returned media once and preserves edits during billing confirmation', async () => {
  const item = { id: 'video', status: 'processing', taskId: 'task', request: { durationSeconds: 4 } }
  const shot = { videos: [item], videoId: '', kept: false, start: 0 }
  let response = pendingCost, added = 0, mediaReads = 0
  const context = vm.createContext({
    pending: new Set(), operationKey: () => 'task', request: async () => response,
    taskState, returnedVideoTaskUrl,
    readProductVideoMediaSize: async () => { mediaReads++; return { duration: 4, width: 720, height: 960 } },
    shotChange: (id, callback) => callback(shot, {}), addAsset: () => { added++ },
  })
  vm.runInContext(functionSource(composable, composableAst, 'pollEntry'), context)
  await context.pollEntry({}, 'shot', 'video', { ...item })
  assert.equal(item.url, url)
  assert.equal(item.status, 'processing')
  assert.equal(shot.videoId, item.id)
  shot.kept = true; shot.start = 1; shot.videoId = 'other-version'
  await context.pollEntry({}, 'shot', 'video', { ...item })
  response = { ...pendingCost, status: 'completed' }
  await context.pollEntry({}, 'shot', 'video', { ...item })
  assert.equal(item.status, 'completed')
  assert.equal(shot.kept, true)
  assert.equal(shot.start, 1)
  assert.equal(shot.videoId, 'other-version')
  assert.equal(added, 1)
  assert.equal(mediaReads, 1)
})
