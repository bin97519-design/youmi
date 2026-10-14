import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import {
  CANVAS_SELECTION_LAYOUTS,
  selectedCanvasLayers,
  expandCanvasGroupSelection,
  selectedCanvasGroup,
  setCanvasSelectionGroup,
  canvasSelectionLayout,
  canvasSelectionContent,
  canvasSelectionExportEntry,
} from '../src/utils/canvasSelection.js'

const nodes = () => [
  { id: 'image', type: 'image', url: '/image.png', x: 20, y: 10, width: 100, height: 150 },
  { id: 'text', type: 'text', text: '保留商品的真实纹理', x: 160, y: 30, width: 120, height: 80 },
  { id: 'video', type: 'video', url: '/video.mp4', x: 70, y: 200, width: 90, height: 120 },
]

test('mixed selection follows canvas order, ignores missing/hidden IDs and supports placeholders', () => {
  const layers = [
    ...nodes(),
    { id: 'hidden', visible: false },
    { id: 'empty', type: 'image-placeholder', y: 400 },
  ]
  assert.deepEqual(
    selectedCanvasLayers(layers, [
      'video',
      'hidden',
      'missing',
      'text',
      'image',
      'image',
      'empty',
    ]).map((layer) => layer.id),
    ['image', 'text', 'video', 'empty'],
  )
})

test('rendered old canvas nodes remain selectable and groupable despite obsolete hidden flags', () => {
  const layers = nodes().map((layer) => ({ ...layer, visible: false }))
  const rendered = new Set(layers.map((layer) => layer.id))
  const ids = layers.map((layer) => layer.id)
  assert.equal(selectedCanvasLayers(layers, ids).length, 0)
  assert.deepEqual(
    selectedCanvasLayers(layers, ids, rendered).map((layer) => layer.id),
    ids,
  )
  assert.deepEqual(
    selectedCanvasLayers(layers, ids, new Set(['image'])).map((layer) => layer.id),
    ['image'],
  )
  setCanvasSelectionGroup(layers, ids, 'legacy-group', '分组 1')
  assert.deepEqual(expandCanvasGroupSelection(layers, ['text'], rendered), [
    'text',
    'image',
    'video',
  ])
  assert.deepEqual(selectedCanvasGroup(layers, ids, rendered), {
    id: 'legacy-group',
    name: '分组 1',
  })
  assert.ok(layers.every((layer) => layer.visible === false))
})

test('groups include mixed media, expand selection without duplicates and recognize only a complete visible group', () => {
  const layers = nodes()
  setCanvasSelectionGroup(layers, ['image', 'text'], 'g1', '分组 1')
  assert.deepEqual(expandCanvasGroupSelection(layers, ['image', 'video', 'image']), [
    'image',
    'video',
    'text',
  ])
  assert.deepEqual(selectedCanvasGroup(layers, ['image', 'text']), { id: 'g1', name: '分组 1' })
  assert.equal(selectedCanvasGroup(layers, ['image']), null)
  assert.equal(selectedCanvasGroup(layers, ['image', 'text', 'video']), null)
  layers.push({ id: 'hidden', groupId: 'g1', visible: false })
  assert.deepEqual(expandCanvasGroupSelection(layers, ['text']), ['text', 'image'])
  assert.ok(selectedCanvasGroup(layers, ['image', 'text']))
})

test('regrouping cleans affected singletons without touching unrelated metadata', () => {
  const layers = [...nodes(), { id: 'unrelated', groupId: 'legacy', groupName: '旧分组' }]
  setCanvasSelectionGroup(layers, ['image', 'text'], 'g1', '第一组')
  setCanvasSelectionGroup(layers, ['text', 'video'], 'g2', '第二组')
  assert.equal(layers[0].groupId, undefined)
  assert.equal(layers[0].groupName, undefined)
  assert.equal(layers[3].groupId, 'legacy')
  setCanvasSelectionGroup(layers, ['text', 'video'])
  assert.equal(layers[1].groupId, undefined)
  assert.equal(layers[2].groupName, undefined)
})

test('all three layouts keep heterogeneous nodes nonoverlapping and do not mutate their dimensions', () => {
  const layers = nodes()
  const original = JSON.stringify(layers)
  for (const mode of ['grid', 'horizontal', 'vertical']) {
    const positions = canvasSelectionLayout(layers, mode)
    assert.equal(positions.size, 3)
    const rectangles = layers.map((layer) => ({ ...layer, ...positions.get(layer.id) }))
    for (let i = 0; i < rectangles.length; i++)
      for (let j = i + 1; j < rectangles.length; j++) {
        const a = rectangles[i],
          b = rectangles[j]
        assert.ok(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        )
      }
  }
  assert.equal(JSON.stringify(layers), original)
})

test('alignment accounts for different node dimensions and keeps the other coordinate', () => {
  const layers = nodes(),
    bounds = { left: 20, right: 280, top: 10, bottom: 320 }
  for (const mode of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
    const positions = canvasSelectionLayout(layers, mode)
    for (const layer of layers) {
      const position = positions.get(layer.id)
      if (['left', 'center', 'right'].includes(mode)) {
        assert.equal(position.y, layer.y)
        const value =
          mode === 'left'
            ? position.x
            : mode === 'right'
              ? position.x + layer.width
              : position.x + layer.width / 2
        assert.equal(
          value,
          mode === 'left'
            ? bounds.left
            : mode === 'right'
              ? bounds.right
              : (bounds.left + bounds.right) / 2,
        )
      } else {
        assert.equal(position.x, layer.x)
        const value =
          mode === 'top'
            ? position.y
            : mode === 'bottom'
              ? position.y + layer.height
              : position.y + layer.height / 2
        assert.equal(
          value,
          mode === 'top'
            ? bounds.top
            : mode === 'bottom'
              ? bounds.bottom
              : (bounds.top + bounds.bottom) / 2,
        )
      }
    }
  }
})

test('distribution keeps the end nodes anchored and equalizes edge spacing', () => {
  for (const [mode, axis, size] of [
    ['distribute-x', 'x', 'width'],
    ['distribute-y', 'y', 'height'],
  ]) {
    const layers = nodes(),
      ordered = [...layers].sort((a, b) => a[axis] - b[axis])
    const positions = canvasSelectionLayout(layers, mode)
    assert.equal(positions.get(ordered[0].id)[axis], ordered[0][axis])
    assert.equal(positions.get(ordered.at(-1).id)[axis], ordered.at(-1)[axis])
    const gaps = ordered
      .slice(1)
      .map(
        (layer, index) =>
          positions.get(layer.id)[axis] -
          positions.get(ordered[index].id)[axis] -
          ordered[index][size],
      )
    assert.ok(Math.abs(gaps[0] - gaps[1]) <= 1)
  }
  assert.equal(canvasSelectionLayout(nodes().slice(0, 2), 'distribute-x').size, 0)
  assert.equal(canvasSelectionLayout(nodes(), 'unknown').size, 0)
  assert.equal(canvasSelectionLayout([], 'grid').size, 0)
  assert.equal(CANVAS_SELECTION_LAYOUTS.length, 11)
})

test('export/chat content never includes pending, failed or empty nodes', () => {
  const layers = [
    ...nodes(),
    { id: 'empty', type: 'text', text: ' ' },
    { id: 'pending', type: 'image', url: '/pending.png', generating: true },
    { id: 'failed', type: 'video', url: '/failed.mp4', status: 'failed' },
    { id: 'placeholder', type: 'image-placeholder' },
  ]
  const content = canvasSelectionContent(layers)
  assert.deepEqual(
    content.images.map((layer) => layer.id),
    ['image'],
  )
  assert.deepEqual(
    content.videos.map((layer) => layer.id),
    ['video'],
  )
  assert.deepEqual(
    content.texts.map((layer) => layer.id),
    ['text'],
  )
})

test('exports preserve UTF-8 text and correct media types and sanitize archive paths', () => {
  const text = canvasSelectionExportEntry(
    { type: 'text', name: '../../产品.txt', text: '透光不透人\n真实纹理' },
    0,
  )
  assert.equal(text.extension, '.txt')
  assert.equal(new TextDecoder().decode(text.data), '透光不透人\n真实纹理')
  assert.ok(!text.baseName.includes('/'))
  const data = new Uint8Array([1, 2, 3])
  assert.equal(
    canvasSelectionExportEntry({ type: 'image', url: '/sample.jpg' }, 1, data, 'image/webp')
      .extension,
    '.webp',
  )
  assert.equal(
    canvasSelectionExportEntry(
      { type: 'video', url: '/sample.webm' },
      1,
      data,
      'application/octet-stream',
    ).extension,
    '.webm',
  )
  assert.equal(
    canvasSelectionExportEntry({ type: 'video', name: '视频.mp4' }, 1, data, 'video/mp4').baseName,
    '视频',
  )
  assert.equal(
    canvasSelectionExportEntry({ type: 'image', name: '...' }, 1, data).baseName,
    '素材-2',
  )
})

const source = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse } = require('@babel/parser')
const ast = parse(source, { sourceType: 'module' })
function load(context, ...names) {
  for (const name of names) {
    const node = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id.name === name,
    )
    assert.ok(node, `Missing function ${name}`)
    vm.runInContext(source.slice(node.start, node.end), context)
  }
}

function actionContext() {
  const layers = nodes(),
    snapshots = [],
    notices = [],
    flushes = []
  const context = vm.createContext({
    layers: { value: layers },
    renderedLayerIds: { value: new Set(layers.map((layer) => layer.id)) },
    props: { id: 'canvas' },
    selectionToolbarMutable: { value: true },
    selectionToolbarGroup: { value: null },
    selectionToolbarLayers: { value: layers.slice(0, 2) },
    userStore: { requireLogin: () => true },
    crypto: { randomUUID: () => 'new-id' },
    pushUndo: (options) => snapshots.push({ options, layers: JSON.stringify(layers) }),
    canvas: {
      updateDocument: (_, mutate) => mutate({ payload: { layers } }),
      flushNow: async (id) => flushes.push(id),
    },
    autoArrangeLayerGeometry: (layer) => layer,
    canvasSelectionRects: (items) => items,
    canvasSelectionLayout,
    setCanvasSelectionGroup,
    nextTick: async () => {},
    refreshConnections: () => {},
    showCopyPasteToast: (text) => notices.push(text),
    selectedLayerId: { value: '' },
    selectedLayerIds: { value: [] },
    marqueeSelectionIds: { value: [] },
    activateLayerKeyboardSelection: () => {},
    expandCanvasGroupSelection,
  })
  load(
    context,
    'arrangeCanvasSelection',
    'toggleCanvasSelectionGroup',
    'selectSingleLayer',
    'selectCanvasGroup',
  )
  return { context, layers, snapshots, notices, flushes }
}

test('actual arrangement changes selected nodes only, saves once and is undoable', async () => {
  const { context, layers, snapshots, flushes } = actionContext()
  const untouched = JSON.stringify(layers[2])
  await context.arrangeCanvasSelection('vertical')
  assert.equal(JSON.stringify(layers[2]), untouched)
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].options.restoreSelection, true)
  assert.equal(flushes.length, 1)
  context.selectionToolbarMutable.value = false
  await context.arrangeCanvasSelection('grid')
  assert.equal(snapshots.length, 1)
})

test('actual grouping saves, selects whole group from any member and allows individual edit/ungroup', async () => {
  const { context, layers, snapshots, flushes } = actionContext()
  await context.toggleCanvasSelectionGroup()
  assert.equal(layers[0].groupId, 'group-new-id')
  assert.equal(layers[1].groupName, '分组 1')
  assert.equal(layers[2].groupId, undefined)
  context.selectSingleLayer(layers[0])
  assert.deepEqual([...context.selectedLayerIds.value], ['image', 'text'])
  context.selectSingleLayer(layers[0], { individual: true })
  assert.deepEqual([...context.selectedLayerIds.value], ['image'])
  context.selectCanvasGroup('group-new-id')
  assert.deepEqual([...context.selectedLayerIds.value], ['image', 'text'])
  context.selectionToolbarGroup.value = { id: 'group-new-id', name: '分组 1' }
  await context.toggleCanvasSelectionGroup()
  assert.equal(layers[0].groupId, undefined)
  assert.equal(snapshots.length, 2)
  assert.equal(flushes.length, 2)
})

test('actual group selection uses rendered membership without rewriting old visibility data', async () => {
  const { context, layers } = actionContext()
  layers.forEach((layer) => {
    layer.visible = false
  })
  await context.toggleCanvasSelectionGroup()
  context.selectSingleLayer(layers[0])
  assert.deepEqual([...context.selectedLayerIds.value], ['image', 'text'])
  context.selectedLayerIds.value = []
  context.selectCanvasGroup(layers[0].groupId)
  assert.deepEqual([...context.selectedLayerIds.value], ['image', 'text'])
  assert.ok(layers.every((layer) => layer.visible === false))
})

test('actual add-to-chat deduplicates references, preserves draft text and never submits generation', async () => {
  const content = canvasSelectionContent(nodes().slice(0, 2)),
    notices = []
  let draft = '已有要求'
  const context = vm.createContext({
    userStore: { requireLogin: () => true },
    selectionToolbarContent: { value: content },
    chatReferenceImages: { value: [] },
    chatReferenceVideos: { value: [] },
    rightPanelVisible: { value: false },
    rightTab: { value: 'layers' },
    activeChatReferenceId: { value: '' },
    crypto: { randomUUID: () => 'id' },
    nextTick: async () => {},
    getEditorPrompt: () => draft,
    refreshConnections: () => {},
    replaceChatEditorText: (text) => {
      draft = text
    },
    document: { querySelector: () => ({ focus: () => {} }) },
    showCopyPasteToast: (text) => notices.push(text),
    addVideoToAgent: () => assert.fail('No video selected'),
  })
  load(context, 'addCanvasSelectionToChat')
  await context.addCanvasSelectionToChat()
  await context.addCanvasSelectionToChat()
  assert.equal(context.chatReferenceImages.value.length, 1)
  assert.equal(context.chatReferenceImages.value[0].layerId, 'image')
  assert.equal(draft, '已有要求\n\n保留商品的真实纹理')
  assert.equal(context.rightPanelVisible.value, true)
  assert.equal(context.rightTab.value, 'chat')
})

test('actual add-to-chat rejects multiple videos without partially altering draft/references', async () => {
  const { context } = actionContext()
  let message = ''
  Object.assign(context, {
    selectionToolbarContent: {
      value: {
        images: nodes().slice(0, 1),
        texts: [],
        videos: [nodes()[2], { ...nodes()[2], url: '/second.mp4' }],
      },
    },
    chatReferenceVideos: { value: [] },
    showCopyPasteToast: (text) => {
      message = text
    },
  })
  load(context, 'addCanvasSelectionToChat')
  await context.addCanvasSelectionToChat()
  assert.match(message, /一次只能添加一个视频/)
})
