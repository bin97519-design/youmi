import test from 'node:test'
import assert from 'node:assert/strict'
import { createVideoNodeActions } from '../src/features/canvas-v3/sync/videoNodeActions.js'

const videoUrl = 'https://assets.example.com/source.mp4'
const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
const clone = (value) => JSON.parse(JSON.stringify(value))
function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function mediaResult(time = 2.75) {
  return {
    time,
    duration: 13.1,
    dataUrl: imageUrl,
    width: 1280,
    height: 720,
    blob: new Blob(['fixture-only'], { type: 'image/png' }),
  }
}
function harness({ capture, download, node: suppliedNode } = {}) {
  let project = 'project-a'
  let account = 'account-a'
  const calls = { capture: [], download: [], add: [], busy: [], remember: 0 }
  const node = suppliedNode || {
    id: 'video-node',
    type: 'generator',
    position: { x: 140, y: 260 },
    selected: true,
    data: {
      kind: 'video',
      title: '原始片段',
      assetUrl: videoUrl,
      mediaWidth: 1280,
      mediaHeight: 720,
      mediaDuration: 13.1,
      runState: 'completed',
      generation: {
        clientTaskId: 'original-client-task',
        taskIds: ['original-provider-task'],
        taskResults: { 'original-provider-task': { state: 'succeeded' } },
      },
      taskId: 'legacy-task-do-not-copy',
      providerKey: 'never-copy-credentials',
    },
  }
  const graph = {
    nodes: [node],
    undoUnits: 0,
    remember() {
      calls.remember++
    },
    addImageAssets(assets, anchor) {
      calls.add.push({ assets: clone(assets), anchor: clone(anchor) })
      this.undoUnits++
      return assets.map((data, index) => ({ id: `new-image-${index}`, data }))
    },
  }
  const actions = createVideoNodeActions({
    graph,
    getScope: () => `${project}:${account}`,
    capture: async (...args) => {
      calls.capture.push(args)
      return capture ? capture(...args) : mediaResult(args[1])
    },
    download: async (...args) => {
      calls.download.push(args)
      return download ? download(...args) : { blob: new Blob(['video']), filename: 'clip.mp4' }
    },
    onBusy: (busy) => calls.busy.push(busy),
  })
  return {
    actions,
    graph,
    node,
    calls,
    setProject: (value) => (project = value),
    setAccount: (value) => (account = value),
  }
}

test('current, first and last frame requests use the actual requested video times', async () => {
  const state = harness()
  for (const [options, expectedTime, label] of [
    [{ time: 2.75, position: 'current' }, 2.75, '当前帧'],
    [{ time: 8, position: 'first' }, 0, '首帧'],
    [{ time: 8, position: 'last' }, 13.1 - 0.04, '尾帧'],
  ]) {
    const result = await state.actions.frame(state.node.id, options)
    const [source, time, request] = state.calls.capture.at(-1)
    assert.equal(source, videoUrl)
    assert.equal(time, expectedTime)
    assert.ok(request.signal instanceof AbortSignal)
    assert.equal(request.signal.aborted, false)
    assert.match(request.filename, new RegExp(`${expectedTime.toFixed(2)}s$`))
    assert.equal(result.time, expectedTime)
    assert.equal(result.sourceNode.data.sourceVideoTime, expectedTime)
    assert.match(result.sourceNode.data.title, new RegExp(label))
  }
  assert.equal(state.calls.add.length, 0, 'reading a frame does not add a node implicitly')
  assert.deepEqual(state.calls.busy, [true, false, true, false, true, false])
})

test('explicit insertion is one atomic addImageAssets operation with source provenance only', async () => {
  const state = harness({ capture: async () => mediaResult(1.234) })
  const before = clone(state.node)
  const result = await state.actions.frame(state.node.id, {
    position: 'current',
    time: 1.25,
    addToCanvas: true,
  })
  assert.equal(state.calls.add.length, 1)
  assert.equal(state.graph.undoUnits, 1)
  assert.equal(state.calls.remember, 0, 'the atomic graph action owns undo history')
  const { assets, anchor } = state.calls.add[0]
  assert.equal(assets.length, 1)
  assert.deepEqual(assets[0], {
    kind: 'image',
    title: '原始片段-当前帧-1.23s.png',
    assetUrl: imageUrl,
    mediaWidth: 1280,
    mediaHeight: 720,
    sourceVideoNodeId: 'video-node',
    sourceVideoTime: 1.234,
    mediaOrigin: 'upload',
    runState: 'idle',
    artifactStatus: 'ready',
  })
  assert.deepEqual(result.sourceNode, { id: 'video-node-frame', data: assets[0] })
  assert.doesNotMatch(
    JSON.stringify(assets),
    /original-client|original-provider|legacy-task|credentials/,
  )
  assert.equal(assets[0].generation, undefined)
  assert.equal(assets[0].taskId, undefined)
  assert.equal(assets[0].clientTaskId, undefined)
  assert.ok(anchor.x > state.node.position.x)
  assert.ok(anchor.y > state.node.position.y)
  assert.deepEqual(state.node, before, 'capturing never changes the original video or its task')
})

test('frame reads use a source snapshot but never copy later node edits into the image result', async () => {
  const pending = deferred()
  const state = harness({ capture: () => pending.promise })
  const result = state.actions.frame(state.node.id, { time: 3, addToCanvas: true })
  state.node.data.title = 'later renamed title'
  state.node.data.generation.clientTaskId = 'later-task-key'
  pending.resolve(mediaResult(3))
  const captured = await result
  assert.match(captured.sourceNode.data.title, /^原始片段-/)
  assert.doesNotMatch(JSON.stringify(state.calls.add), /later-task-key|later renamed/)
})

test('an in-flight read blocks duplicate capture and download until the original finishes', async () => {
  const pending = deferred()
  const state = harness({ capture: () => pending.promise })
  const first = state.actions.frame(state.node.id, { time: 2, addToCanvas: true })
  await assert.rejects(state.actions.frame(state.node.id), /正在读取视频/)
  await assert.rejects(state.actions.download(state.node.id), /正在读取视频/)
  assert.equal(state.calls.capture.length, 1)
  assert.equal(state.calls.download.length, 0)
  assert.deepEqual(state.calls.busy, [true])
  pending.resolve(mediaResult(2))
  await first
  await state.actions.frame(state.node.id, { time: 4 })
  assert.equal(state.calls.capture.length, 2)
  assert.deepEqual(state.calls.busy, [true, false, true, false])
})

test('capture failure never adds an image and always releases busy state for a later request', async () => {
  let fail = true
  const state = harness({
    capture: async () => {
      if (fail) throw new Error('CORS prevented a real screenshot')
      return mediaResult(1)
    },
  })
  await assert.rejects(
    state.actions.frame(state.node.id, { addToCanvas: true }),
    /CORS prevented a real screenshot/,
  )
  assert.equal(state.calls.add.length, 0)
  assert.deepEqual(state.calls.busy, [true, false])
  fail = false
  await state.actions.frame(state.node.id, { time: 1, addToCanvas: true })
  assert.equal(state.calls.add.length, 1)
  assert.deepEqual(state.calls.busy, [true, false, true, false])
})

for (const [name, invalidate] of [
  ['cancel', (state) => state.actions.cancel()],
  ['project change', (state) => state.setProject('project-b')],
  ['account change', (state) => state.setAccount('account-b')],
  [
    'source URL change',
    (state) => (state.node.data.assetUrl = 'https://assets.example.com/new.mp4'),
  ],
  ['source kind change', (state) => (state.node.data.kind = 'image')],
  ['source node deletion', (state) => state.graph.nodes.splice(0)],
  ['dispose', (state) => state.actions.dispose()],
]) {
  test(`${name} discards a late capture result without adding an image`, async () => {
    const pending = deferred()
    const state = harness({ capture: () => pending.promise })
    const read = state.actions.frame(state.node.id, { time: 2, addToCanvas: true })
    const rejected = assert.rejects(read, { name: 'AbortError' })
    invalidate(state)
    if (name === 'cancel' || name === 'dispose')
      assert.equal(state.calls.capture[0][2].signal.aborted, true)
    pending.resolve(mediaResult(2))
    await rejected
    assert.equal(state.calls.add.length, 0)
    assert.deepEqual(state.calls.busy, [true, false])
  })
}

test('download requests read the actual original with save:false and return only the confirmed result', async () => {
  const downloaded = { blob: new Blob(['real-mocked-media']), filename: 'source.mp4' }
  const state = harness({ download: async () => downloaded })
  assert.equal(await state.actions.download(state.node.id), downloaded)
  assert.equal(state.calls.capture.length, 0)
  assert.equal(state.calls.add.length, 0)
  const [[source, options]] = state.calls.download
  assert.equal(source, videoUrl)
  assert.equal(options.save, false, 'the caller controls the explicit download delivery')
  assert.equal(options.filename, '原始片段')
  assert.ok(options.signal instanceof AbortSignal)
  assert.deepEqual(state.calls.busy, [true, false])
})

test('late downloads are rejected after scope changes and cannot deliver stale media', async () => {
  const pending = deferred()
  const state = harness({ download: () => pending.promise })
  const read = state.actions.download(state.node.id)
  const rejected = assert.rejects(read, { name: 'AbortError' })
  state.setAccount('another-account')
  pending.resolve({ blob: new Blob(['stale-video']), filename: 'old.mp4' })
  await rejected
  assert.deepEqual(state.calls.busy, [true, false])
  assert.equal(state.calls.add.length, 0)
})

test('download errors release busy state without pretending that a file was saved', async () => {
  const state = harness({
    download: async () => {
      throw new Error('HTML is not video media')
    },
  })
  await assert.rejects(state.actions.download(state.node.id), /HTML is not video media/)
  assert.deepEqual(state.calls.busy, [true, false])
  assert.equal(state.calls.add.length, 0)
})

test('missing nodes, non-video nodes and missing finished sources never invoke media helpers', async () => {
  for (const patch of [null, { kind: 'image' }, { assetUrl: '' }]) {
    const state = harness()
    if (patch) Object.assign(state.node.data, patch)
    else state.graph.nodes = []
    await assert.rejects(state.actions.frame('video-node'), /请选择有成品视频的节点/)
    await assert.rejects(state.actions.download('video-node'), /请选择有成品视频的节点/)
    assert.deepEqual(state.calls, { capture: [], download: [], add: [], busy: [], remember: 0 })
  }
})

test('invalid current times and unknown tail duration reject before capture and reset busy', async () => {
  const state = harness()
  for (const time of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, 'not-a-time'])
    await assert.rejects(state.actions.frame(state.node.id, { time }), /截帧时间无效/)
  state.node.data.mediaDuration = 0
  await assert.rejects(state.actions.frame(state.node.id, { position: 'last' }), /尚未读取视频时长/)
  assert.equal(state.calls.capture.length, 0)
  assert.equal(state.calls.add.length, 0)
  assert.deepEqual(state.calls.busy, Array.from({ length: 5 }, () => [true, false]).flat())
})

test('dispose aborts an active read and permanently rejects subsequent operations', async () => {
  const pending = deferred()
  const state = harness({ capture: () => pending.promise })
  const read = state.actions.frame(state.node.id, { addToCanvas: true })
  const rejected = assert.rejects(read, { name: 'AbortError' })
  state.actions.dispose()
  assert.equal(state.calls.capture[0][2].signal.aborted, true)
  await assert.rejects(state.actions.frame(state.node.id), { name: 'AbortError' })
  await assert.rejects(state.actions.download(state.node.id), { name: 'AbortError' })
  pending.resolve(mediaResult())
  await rejected
  state.actions.dispose()
  assert.equal(state.calls.add.length, 0)
  assert.deepEqual(state.calls.busy, [true, false])
})

test('a saved asset transient source may be captured without inserting the original video in the graph', async () => {
  const pending = deferred()
  const state = harness({ capture: () => pending.promise })
  const asset = {
    ...clone(state.node),
    id: 'saved-asset-preview-only',
    position: { x: 0, y: 0 },
  }
  asset.data.title = '我的视频资产'
  const read = state.actions.frame(asset, { time: 3.5, addToCanvas: true })
  // Asset previews are intentionally absent from the graph. Even unrelated
  // real-node removal must not make a valid transient asset look deleted.
  state.graph.nodes = []
  pending.resolve(mediaResult(3.5))
  const result = await read
  assert.equal(state.graph.nodes.length, 0, 'reading an asset never inserts the original video')
  assert.equal(state.calls.add.length, 1)
  assert.equal(state.calls.add[0].assets[0].kind, 'image')
  assert.equal(result.sourceNode.data.sourceVideoNodeId, asset.id)
  assert.equal(result.sourceNode.data.sourceVideoTime, 3.5)
  assert.equal(result.sourceNode.data.generation, undefined)
  assert.deepEqual(state.calls.busy, [true, false])
})

for (const [name, invalidate] of [
  ['preview close cancellation', (state) => state.actions.cancel()],
  ['account change', (state) => state.setAccount('other-asset-owner')],
  [
    'transient source change',
    (_state, asset) => (asset.data.assetUrl = 'https://assets.example.com/other.mp4'),
  ],
]) {
  test(`${name} discards an in-flight saved asset preview capture`, async () => {
    const pending = deferred()
    const state = harness({ capture: () => pending.promise })
    const asset = { ...clone(state.node), id: 'saved-asset-preview-only' }
    const read = state.actions.frame(asset, { time: 2, addToCanvas: true })
    const rejected = assert.rejects(read, { name: 'AbortError' })
    invalidate(state, asset)
    pending.resolve(mediaResult(2))
    await rejected
    assert.equal(state.calls.add.length, 0)
    assert.deepEqual(state.calls.busy, [true, false])
  })
}

test('transient saved asset downloads retain the same scope and no-auto-save contract', async () => {
  const state = harness()
  const asset = { ...clone(state.node), id: 'saved-asset-preview-only' }
  state.graph.nodes = []
  const result = await state.actions.download(asset)
  assert.ok(result.blob instanceof Blob)
  assert.equal(state.calls.download.length, 1)
  assert.equal(state.calls.download[0][0], asset.data.assetUrl)
  assert.equal(state.calls.download[0][1].save, false)
  assert.equal(state.calls.add.length, 0)
  assert.deepEqual(state.calls.busy, [true, false])
})
