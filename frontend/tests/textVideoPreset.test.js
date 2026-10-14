import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import { CANVAS_TEXT_NODE_LAYOUT } from '../src/utils/canvasEmptyNodeLayout.js'
import { missingNodeConnections } from '../src/utils/canvasNodeConnections.js'
import { normalizeVideoNodeDraft } from '../src/utils/videoNodeDraft.js'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse } = require('@babel/parser')
const source = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const fn = parse(source, { sourceType: 'module' }).program.body.find(
  (item) => item.type === 'FunctionDeclaration' && item.id?.name === 'openTextVideoPreset',
)

function setup(type = 'text', extra = []) {
  const node = {
    id: 'source',
    name: 'source',
    type,
    text: type === 'text' ? 'Existing script' : '',
    url: '',
    x: 80,
    y: 160,
    width: 360,
    height: 480,
    visible: true,
    zIndex: 1,
  }
  const payload = {
    layers: [node, ...extra],
    connections: [],
    view: { scale: 0.5, offset: { x: 20, y: 40 } },
  }
  const undo = [],
    saves = [],
    selections = []
  let id = 0
  const context = vm.createContext({
    props: { id: 'canvas' },
    layers: { value: payload.layers },
    connections: { value: [] },
    userStore: { requireLogin: () => true },
    textNodeActivity: {},
    activeTool: { value: 'select' },
    isEditableTextNode: (layer) =>
      layer.type === 'text' &&
      !layer.locked &&
      !layer.generating &&
      layer.videoReversePrompt?.status !== 'pending',
    videoNodeBusy: (layer) => Boolean(layer.generating),
    CANVAS_IMAGE_WIDTH: 360,
    CANVAS_TEXT_NODE_LAYOUT,
    normalizeVideoNodeDraft,
    videoModelOptions: [],
    chatVideoGenerationSettings: { value: { ratio: '3:4' } },
    crypto: { randomUUID: () => `test-${++id}` },
    layerName: (index) => `layer ${index + 1}`,
    missingNodeConnections,
    pushUndo: (options) => undo.push({ options, payload: structuredClone(payload) }),
    canvas: {
      updateDocument: (canvasId, update) => {
        assert.equal(canvasId, 'canvas')
        update({ payload })
      },
      flushNow: async (canvasId) => {
        saves.push(canvasId)
      },
    },
    selectCanvasGroup: (groupId) => {
      selections.push(groupId)
    },
    nextTick: async () => {},
    refreshConnections: () => {},
  })
  vm.runInContext(source.slice(fn.start, fn.end), context)
  return { context, node, payload, undo, saves, selections }
}

test('text-to-video creates a connected group without changing the source or camera', async () => {
  const item = setup(),
    before = structuredClone(item.node),
    view = structuredClone(item.payload.view)
  await item.context.openTextVideoPreset(item.node)
  const video = item.payload.layers.find((layer) => layer.type === 'video')
  assert.ok(video)
  assert.equal(video.width, 360)
  assert.equal(video.height, 480)
  assert.equal(video.x, before.x + before.width + 80)
  assert.equal(video.y, before.y)
  assert.equal(video.groupName, '文生视频')
  assert.equal(video.groupId, item.node.groupId)
  assert.equal(video.videoNodeDraft.config.ratio, '3:4')
  for (const key of ['text', 'x', 'y', 'width', 'height']) assert.equal(item.node[key], before[key])
  assert.deepEqual(item.payload.view, view)
  assert.equal(item.payload.connections.length, 1)
  assert.equal(item.payload.connections[0].fromLayerId, item.node.id)
  assert.equal(item.payload.connections[0].toLayerId, video.id)
  assert.equal(item.undo.length, 1)
  assert.equal(item.undo[0].options.restoreSelection, true)
  assert.equal(item.undo[0].payload.layers.length, 1)
  assert.deepEqual(item.saves, ['canvas'])
  assert.deepEqual(item.selections, [video.groupId])
})

test('video entry adds a text input on the left and preserves video settings', async () => {
  const item = setup('video')
  item.node.videoNodeDraft = normalizeVideoNodeDraft({
    prompt: 'Saved motion',
    config: { ratio: '16:9' },
  })
  const before = structuredClone(item.node.videoNodeDraft)
  await item.context.openTextVideoPreset(item.node)
  const text = item.payload.layers.find((layer) => layer.type === 'text')
  assert.equal(text.x, item.node.x - 440)
  assert.equal(text.y, item.node.y)
  assert.equal(text.width, 360)
  assert.equal(text.height, 480)
  assert.equal(text.text, '')
  assert.deepEqual(item.node.videoNodeDraft, before)
  assert.equal(item.payload.connections[0].fromLayerId, text.id)
  assert.equal(item.payload.connections[0].toLayerId, item.node.id)
})

test('reopening from either member does not duplicate nodes, edges or undo entries', async () => {
  const item = setup()
  await item.context.openTextVideoPreset(item.node)
  const video = item.payload.layers.find((layer) => layer.type === 'video')
  await item.context.openTextVideoPreset(item.node)
  await item.context.openTextVideoPreset(video)
  assert.equal(item.payload.layers.length, 2)
  assert.equal(item.payload.connections.length, 1)
  assert.equal(item.undo.length, 1)
  assert.equal(item.selections.length, 3)
})

test('existing groups and occupied positions are preserved', async () => {
  const blocker = {
    id: 'blocker',
    type: 'image',
    x: 520,
    y: 160,
    width: 360,
    height: 480,
    visible: true,
    zIndex: 2,
  }
  const member = {
    id: 'member',
    type: 'image',
    x: -500,
    y: -400,
    width: 360,
    height: 480,
    groupId: 'original-group',
    groupName: 'Existing group',
    visible: true,
  }
  const item = setup('text', [blocker, member]),
    before = structuredClone([blocker, member])
  Object.assign(item.node, { groupId: 'original-group', groupName: 'Existing group' })
  await item.context.openTextVideoPreset(item.node)
  const video = item.payload.layers.find((layer) => layer.type === 'video')
  assert.equal(video.groupId, 'original-group')
  assert.equal(video.groupName, 'Existing group')
  assert.equal(video.y, item.node.y)
  assert.ok(video.x >= blocker.x + blocker.width + 80)
  assert.deepEqual([blocker, member], before)
})

test('fractional source positions keep both preset nodes top aligned', async () => {
  for (const type of ['text', 'video']) {
    const item = setup(type)
    Object.assign(item.node, { x: 80.4, y: 160.7 })
    await item.context.openTextVideoPreset(item.node)
    const peer = item.payload.layers.find((layer) => layer.id !== item.node.id)
    assert.equal(peer.y, 160.7)
    assert.ok(Math.abs(peer.x - (type === 'text' ? 520.4 : -359.6)) < 1e-8)
    assert.equal(item.node.x, 80.4)
    assert.equal(item.node.y, 160.7)
  }
})

test('a blocked left-hand text node stays in the video row and avoids existing nodes', async () => {
  const blocker = {
    id: 'blocker',
    type: 'image',
    x: -360,
    y: 160,
    width: 360,
    height: 480,
    visible: true,
  }
  const item = setup('video', [blocker]),
    before = structuredClone(blocker)
  await item.context.openTextVideoPreset(item.node)
  const text = item.payload.layers.find((layer) => layer.type === 'text')
  assert.equal(text.y, item.node.y)
  assert.ok(text.x + text.width + 80 <= blocker.x)
  assert.deepEqual(blocker, before)
})

test('busy, locked, deleted, unauthorized or populated video nodes cannot create presets', async () => {
  for (const patch of [
    { locked: true },
    { generating: true },
    { videoReversePrompt: { status: 'pending' } },
  ]) {
    const item = setup()
    Object.assign(item.node, patch)
    await item.context.openTextVideoPreset(item.node)
    assert.equal(item.payload.layers.length, 1)
    assert.equal(item.undo.length, 0)
  }
  for (const patch of [{ url: 'https://media.test/video.mp4' }, { taskId: 'active' }]) {
    const item = setup('video')
    Object.assign(item.node, patch)
    await item.context.openTextVideoPreset(item.node)
    assert.equal(item.undo.length, 0)
  }
  const denied = setup()
  denied.context.userStore.requireLogin = () => false
  await denied.context.openTextVideoPreset(denied.node)
  assert.equal(denied.undo.length, 0)
  const deleted = setup()
  deleted.context.layers.value = []
  await deleted.context.openTextVideoPreset(deleted.node)
  assert.equal(deleted.undo.length, 0)
})

test('a copied group reuses its own connected peer instead of stale original IDs', async () => {
  const originalVideo = {
    id: 'original-video',
    type: 'video',
    groupId: 'original-group',
    url: '',
    x: 1000,
    y: 160,
    width: 360,
    height: 480,
  }
  const copiedVideo = {
    id: 'copied-video',
    type: 'video',
    groupId: 'copied-group',
    url: '',
    x: 520,
    y: 160,
    width: 360,
    height: 480,
  }
  const item = setup('text', [originalVideo, copiedVideo])
  Object.assign(item.node, {
    groupId: 'copied-group',
    groupName: 'Copied group',
    textVideoPeerId: 'original-video',
  })
  item.context.connections.value = item.payload.connections = [
    {
      id: 'copied-edge',
      fromLayerId: 'source',
      fromPort: 'right',
      toLayerId: 'copied-video',
      toPort: 'left',
    },
  ]
  await item.context.openTextVideoPreset(item.node)
  assert.equal(item.payload.layers.length, 3)
  assert.equal(item.payload.connections.length, 1)
  assert.equal(item.undo.length, 0)
  assert.deepEqual(item.selections, ['copied-group'])
  assert.equal(originalVideo.groupId, 'original-group')
})

test('a deleted peer is recreated without touching unrelated nodes', async () => {
  const item = setup()
  await item.context.openTextVideoPreset(item.node)
  const oldPeerId = item.node.textVideoPeerId
  item.payload.layers.splice(1, 1)
  item.context.connections.value = item.payload.connections = []
  await item.context.openTextVideoPreset(item.node)
  assert.notEqual(item.node.textVideoPeerId, oldPeerId)
  assert.equal(item.payload.layers.length, 2)
  assert.equal(item.payload.connections.length, 1)
  assert.equal(item.undo.length, 2)
})
