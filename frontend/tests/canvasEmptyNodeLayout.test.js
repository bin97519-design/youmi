import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import {
  CANVAS_TEXT_NODE_LAYOUT,
  emptyMediaNodeDimensions,
  canvasGenerationDimensions,
  legacyEmptyTextNodeLayout,
} from '../src/utils/canvasEmptyNodeLayout.js'
import { normalizeImageNodeDraft } from '../src/utils/imageNodeDraft.js'
import { isSeedanceAnciModel } from '../src/utils/seedanceAnci.js'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse } = require('@babel/parser')
const source = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const ast = parse(source, { sourceType: 'module' })

function context(items = [], synced = true) {
  const payload = {
    layers: structuredClone(items),
    view: { scale: 0.4, offset: { x: 1250, y: 415 } },
    connections: [],
  }
  const saves = []
  const state = vm.createContext({
    CANVAS_TEXT_NODE_LAYOUT,
    CANVAS_IMAGE_WIDTH: 360,
    emptyMediaNodeDimensions,
    canvasGenerationDimensions,
    DEFAULT_VIDEO_RATIO: '3:4',
    legacyEmptyTextNodeLayout,
    normalizeImageNodeDraft,
    isSeedanceAnciModel,
    doc: { value: { payload } },
    props: { id: 'test-layout' },
    layers: {
      get value() {
        return payload.layers
      },
    },
    canvas: {
      serverSynced: synced,
      updateDocument: (id, patch) => {
        patch({ payload })
        saves.push(id)
      },
    },
    chatRatio: { value: '9:16' },
    chatModel: { value: 'test-image' },
    chatResolution: { value: '2K' },
    chatModelOptions: ['test-image'],
    userStore: { requireLogin: () => true },
    pushUndo: () => {},
    layerName: (i) => `Layer ${i}`,
    selectedLayer: { value: null },
    selectedLayerId: { value: '' },
    selectedLayerIds: { value: [] },
    activeTool: { value: '' },
    viewScale: { value: 0.4 },
    viewOffset: { value: payload.view.offset },
    panel: { x: 0 },
  })
  for (const name of [
    'normalizeEmptyCanvasNodeLayout',
    'nodeCreationPosition',
    'addImageNode',
    'addVideoNode',
    'addGeneratingVideoLayer',
    'addTextNode',
    'canvasVideoSize',
    'saveActiveImageNodeDraft',
  ]) {
    const node = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id?.name === name,
    )
    assert.ok(node, name)
    vm.runInContext(source.slice(node.start, node.end), state)
  }
  return { state, payload, saves }
}

test('empty image nodes stay 360 by 480 independently of their generation ratio', () => {
  for (const ratio of ['9:16', '3:4', '1:1', '16:9', '21:9', 'auto']) {
    assert.deepEqual(
      emptyMediaNodeDimensions({
        type: 'image-placeholder',
        width: 200,
        height: 200,
        imageNodeDraft: { config: { ratio } },
      }),
      { width: 360, height: 480 },
    )
  }
  assert.deepEqual(
    emptyMediaNodeDimensions({ type: 'image-placeholder', width: 240, height: 320 }),
    { width: 360, height: 480 },
  )
  assert.deepEqual(emptyMediaNodeDimensions({ type: 'image-placeholder', width: 0, height: 0 }), {
    width: 360,
    height: 480,
  })
  for (const layer of [
    { type: 'image' },
    { type: 'image-placeholder', url: '/existing.png' },
    { type: 'image-placeholder', generating: true },
    { type: 'image-placeholder', locked: true },
  ]) {
    assert.deepEqual(emptyMediaNodeDimensions(layer), {})
  }
})

test('only the exact legacy empty text layout is corrected', () => {
  const layer = { type: 'text', text: '', width: 440, height: 320, fontSize: 14 }
  assert.deepEqual(legacyEmptyTextNodeLayout(layer), { width: 360, height: 480, fontSize: 24 })
  assert.deepEqual(legacyEmptyTextNodeLayout({ ...layer, width: 360, height: 200, fontSize: 24 }), {
    width: 360,
    height: 480,
    fontSize: 24,
  })
  for (const change of [
    { text: 'Existing prompt' },
    { locked: true },
    { fontSize: 28 },
    { width: 300 },
    { videoReversePrompt: { status: 'completed' } },
  ]) {
    assert.deepEqual(legacyEmptyTextNodeLayout({ ...layer, ...change }), {})
  }
})

test('in-memory layout correction preserves view without replacing newer server content', () => {
  const original = [
    {
      id: 'image',
      type: 'image-placeholder',
      x: 300,
      y: 100,
      width: 200,
      height: 200,
      imageNodeDraft: {
        prompt: 'Keep this',
        config: { ratio: '9:16' },
        references: [{ url: '/reference.png' }],
      },
    },
    {
      id: 'text',
      type: 'text',
      x: 100,
      y: 300,
      width: 440,
      height: 320,
      fontSize: 14,
      text: '',
      groupId: 'group',
    },
    {
      id: 'existing',
      type: 'text',
      x: 400,
      y: 300,
      width: 500,
      height: 320,
      fontSize: 18,
      text: 'Keep my prompt',
    },
  ]
  const { state, payload, saves } = context(original, false)
  state.doc.value.updatedAt = 123
  const view = JSON.stringify(payload.view)
  state.normalizeEmptyCanvasNodeLayout()
  assert.equal(saves.length, 0)
  assert.equal(state.doc.value.updatedAt, 123)
  assert.equal(payload.layers[0].width, 360)
  assert.equal(payload.layers[0].height, 480)
  assert.deepEqual(payload.layers[0].imageNodeDraft, original[0].imageNodeDraft)
  assert.equal(payload.layers[1].width, 360)
  assert.equal(payload.layers[1].height, 480)
  assert.equal(payload.layers[1].groupId, 'group')
  assert.deepEqual(payload.layers[2], original[2])
  assert.equal(JSON.stringify(payload.view), view)
  for (let i = 0; i < original.length; i++) {
    assert.equal(payload.layers[i].x, original[i].x)
    assert.equal(payload.layers[i].y, original[i].y)
  }
  state.normalizeEmptyCanvasNodeLayout()
  assert.equal(
    saves.length,
    0,
    'Layout correction must not flush cached content over server content',
  )
  payload.layers = structuredClone(original)
  payload.layers[2].text = 'Newer server prompt'
  state.normalizeEmptyCanvasNodeLayout()
  assert.equal(payload.layers[2].text, 'Newer server prompt')
})

test('new image and text nodes share a 360 width and use their actual height for connection placement', () => {
  const { state, payload } = context()
  const imageId = state.addImageNode({ connectionDrop: { x: 600, y: 500, sourcePort: 'right' } })
  const image = payload.layers.find((layer) => layer.id === imageId)
  assert.equal(image.width, 360)
  assert.equal(image.height, 480)
  assert.equal(image.y, 260)
  assert.equal(image.imageNodeDraft.config.ratio, '9:16')
  const textId = state.addTextNode({ connectionDrop: { x: 600, y: 500, sourcePort: 'right' } })
  const text = payload.layers.find((layer) => layer.id === textId)
  assert.equal(text.width, 360)
  assert.equal(text.height, 480)
  assert.equal(text.fontSize, 24)
  assert.equal(text.y, 260)
  const videoId = state.addVideoNode()
  const video = payload.layers.find((layer) => layer.id === videoId)
  assert.equal(video.width, 360)
  assert.equal(video.height, 480)
})

test('changing the generation ratio keeps the node 3:4 without resizing a real image', () => {
  const { state, payload, saves } = context([
    { id: 'empty', type: 'image-placeholder', width: 360, height: 640 },
  ])
  Object.assign(state, {
    activeImageNodeCanvasId: 'test-layout',
    inlineDialogModification: { layerId: 'empty' },
    isEditableImageNode: () => true,
    updateLayer: (id, patch) => {
      Object.assign(
        payload.layers.find((layer) => layer.id === id),
        patch,
      )
      saves.push(id)
    },
    imageNodeDraft: { value: { config: { ratio: '16:9' }, prompt: 'Keep this' } },
  })
  state.saveActiveImageNodeDraft()
  assert.equal(payload.layers[0].height, 480)
  assert.equal(payload.layers[0].width, 360)
  state.saveActiveImageNodeDraft()
  assert.equal(saves.length, 1)
  payload.layers[0].type = 'image'
  payload.layers[0].url = '/existing.png'
  state.imageNodeDraft.value.config.ratio = '9:16'
  state.saveActiveImageNodeDraft()
  assert.equal(payload.layers[0].height, 480)
})

test('generation size uses the selected parameter ratio rather than a conflicting reference image', () => {
  const reference = { width: 300, height: 300 }
  assert.deepEqual(canvasGenerationDimensions('9:16', 360, reference), { width: 360, height: 640 })
  assert.deepEqual(canvasGenerationDimensions('16:9', 360, reference), { width: 360, height: 203 })
  assert.deepEqual(canvasGenerationDimensions('auto', 360, reference), { width: 360, height: 360 })
  const { state } = context()
  for (const [ratio, height] of [
    ['3:4', 480],
    ['9:16', 640],
    ['16:9', 203],
    ['21:9', 154],
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(state.canvasVideoSize(ratio))), {
      width: 360,
      height,
    })
  }
  assert.deepEqual(emptyMediaNodeDimensions({ type: 'video', url: '' }), {
    width: 360,
    height: 480,
  })
  assert.deepEqual(
    emptyMediaNodeDimensions({ type: 'video', taskId: 'active', width: 360, height: 640 }),
    {},
  )
  assert.deepEqual(canvasGenerationDimensions('0:1'), { width: 360, height: 480 })
})

test('video generation reuses the node at 360 wide and changes only height to the requested ratio', () => {
  const { state, payload } = context([
    { id: 'video', type: 'video', url: '', x: 400, y: 300, width: 360, height: 480 },
  ])
  Object.assign(state, {
    findAvailableCanvasLayerPosition: () => ({ x: 0, y: 0 }),
    isPerSecondVideoModel: () => true,
    revealCanvasMedia: () => {},
    focusVideoNodeEditor: () => {},
  })
  const id = state.addGeneratingVideoLayer(
    'Keep my video prompt',
    { ratio: '9:16', model: 'video' },
    'assistant',
    [],
    { reuseLayerId: 'video' },
  )
  assert.equal(id, 'video')
  assert.equal(payload.layers[0].width, 360)
  assert.equal(payload.layers[0].height, 640)
  assert.equal(payload.layers[0].x, 400)
  assert.equal(payload.layers[0].y, 300)
  assert.equal(payload.layers[0].generating, true)
  state.normalizeEmptyCanvasNodeLayout()
  assert.equal(payload.layers[0].height, 640, 'An in-flight generated node must not revert to 3:4')
})
