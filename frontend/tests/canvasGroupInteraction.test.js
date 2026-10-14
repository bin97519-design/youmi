import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse } = require('@babel/parser')
const source = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const ast = parse(source, { sourceType: 'module' })
function load(context, name) {
  const node = ast.program.body.find(
    (item) => item.type === 'FunctionDeclaration' && item.id?.name === name,
  )
  assert.ok(node)
  vm.runInContext(source.slice(node.start, node.end), context)
}
const images = () =>
  ['a', 'b', 'c'].map((id, index) => ({
    id,
    type: 'image',
    url: `/${id}.png`,
    groupId: 'g1',
    x: index * 160,
    y: 80,
    width: 120,
    height: 160,
  }))

test('dragging a saved group background selects every rendered member, including old hidden flags', () => {
  const members = images().map((layer) => ({ ...layer, visible: false })),
    calls = []
  const context = vm.createContext({
    layers: { value: members },
    renderedLayerIds: { value: new Set(['a', 'b', 'c']) },
    selectedLayerId: { value: 'b' },
    selectedLayerIds: { value: ['b'] },
    marqueeSelectionIds: { value: [] },
    spacePanHeld: { value: false },
    dragState: { value: null },
    activeTool: { value: 'select' },
    activateLayerKeyboardSelection: () => {},
    startLayerDrag: (...args) => calls.push(args),
  })
  load(context, 'startCanvasGroupDrag')
  const event = { button: 0 }
  context.startCanvasGroupDrag(event, 'g1')
  assert.deepEqual([...context.selectedLayerIds.value], ['a', 'b', 'c'])
  assert.equal(context.selectedLayerId.value, 'b')
  assert.equal(calls[0][1].id, 'b')
  assert.equal(calls[0][2].fromGroupFrame, true)
  assert.deepEqual([...calls[0][2].groupSourceIds], ['a', 'b', 'c'])
  assert.ok(members.every((layer) => layer.visible === false))
})

test('a temporary multi-selection background uses the current selection and ignores other groups', () => {
  const members = images(),
    calls = []
  const context = vm.createContext({
    layers: { value: members },
    selectionToolbarLayers: { value: members.slice(0, 2) },
    selectedLayerId: { value: 'a' },
    selectedLayerIds: { value: ['a', 'b'] },
    marqueeSelectionIds: { value: [] },
    spacePanHeld: { value: false },
    dragState: { value: null },
    activeTool: { value: 'select' },
    activateLayerKeyboardSelection: () => {},
    startLayerDrag: (...args) => calls.push(args),
  })
  load(context, 'startCanvasGroupDrag')
  context.startCanvasGroupDrag({ button: 0 })
  assert.deepEqual([...calls[0][2].groupSourceIds], ['a', 'b'])
  context.spacePanHeld.value = true
  context.startCanvasGroupDrag({ button: 0 })
  context.spacePanHeld.value = false
  context.activeTool.value = 'annotate'
  context.startCanvasGroupDrag({ button: 0 })
  assert.equal(calls.length, 1)
})

function releaseContext({ moved = false, fromGroupFrame = false, clickSelectLayerId = 'b' } = {}) {
  const members = images(),
    selected = []
  const context = vm.createContext({
    layers: { value: members },
    props: { id: 'canvas' },
    dragState: {
      value: {
        ids: ['a', 'b', 'c'],
        primaryLayerId: 'b',
        startX: 20,
        startY: 20,
        moved,
        fromGroupFrame,
        clickSelectLayerId,
      },
    },
    _dragRafId: null,
    _layerDragListenersAttached: false,
    canvas: { updateDocument: () => {} },
    layerClickMemory: {},
    snapGuides: { value: [] },
    restoreDraggingLayerForeground: () => {},
    nextTick: (callback) => callback(),
    refreshConnections: () => {},
    selectSingleLayer: (layer, options) => selected.push({ layer, options }),
  })
  load(context, 'stopLayerDrag')
  return { context, members, selected }
}

test('a stationary group member click activates only that node for its editor without ungrouping', () => {
  const { context, members, selected } = releaseContext()
  const original = JSON.stringify(members)
  context.stopLayerDrag({ type: 'pointerup', clientX: 20, clientY: 20 })
  assert.equal(selected.length, 1)
  assert.equal(selected[0].layer.id, 'b')
  assert.equal(selected[0].options.individual, true)
  assert.equal(JSON.stringify(members), original)
  assert.equal(context.dragState.value, null)
})

test('background releases and actual group movement do not open individual editors', () => {
  for (const options of [{ fromGroupFrame: true, clickSelectLayerId: '' }, { moved: true }]) {
    const { context, selected } = releaseContext(options)
    context.stopLayerDrag({ type: 'pointerup', clientX: 20, clientY: 20 })
    assert.equal(selected.length, 0)
    assert.equal(context.layerClickMemory.layerId, '')
  }
  const { context, selected } = releaseContext()
  context.stopLayerDrag({ type: 'pointercancel', clientX: 20, clientY: 20 })
  assert.equal(selected.length, 0)
})

test('small pointer jitter is a click and only deliberate movement starts a drag update', () => {
  const callbacks = [],
    context = vm.createContext({
      doc: { value: { payload: { view: { scale: 0.5 } } } },
      dragState: { value: { startX: 10, startY: 10, moved: false } },
      _dragRafId: null,
      enforceDraggingLayerForeground: () => {},
      requestAnimationFrame: (callback) => {
        callbacks.push(callback)
        return 1
      },
    })
  load(context, 'moveLayer')
  context.moveLayer({ clientX: 12, clientY: 13 })
  assert.equal(callbacks.length, 0)
  assert.equal(context.dragState.value.moved, false)
  context.moveLayer({ clientX: 17, clientY: 10 })
  assert.equal(callbacks.length, 1)
  assert.equal(context.dragState.value.moved, true)
  assert.equal(context.dragState.value._rawDx, 14)
})

test('resolving grouped or ungrouped image and video editors never reframes the canvas or closes its sidebar', async () => {
  const view = { scale: 0.23, offset: { x: 682, y: 112 } },
    saves = []
  const members = [...images(), { ...images()[0], id: 'video', type: 'video', url: '/clip.mp4' }]
  const editor = { getBoundingClientRect: () => assert.fail('Editor lookup must not measure the viewport') }
  const context = vm.createContext({
    props: { id: 'canvas' },
    layers: { value: members },
    canvasNodeFocusSuspended: false,
    canvasNodeFocusRevision: 0,
    selectedLayerId: { value: 'a' },
    rightPanelVisible: { value: true },
    nextTick: () => Promise.resolve(),
    doc: { value: { payload: { view } } },
    document: { querySelector: () => editor },
    CSS: { escape: value => value },
    canvas: { updateDocument: (...args) => saves.push(args) },
  })
  load(context, 'getCanvasNodeEditor')
  const original = JSON.stringify(view)
  for (const grouped of [true, false]) {
    for (const member of members) member.groupId = grouped ? 'g1' : ''
    for (const [id, selector] of [['a', '.image-node-composer'], ['video', '.video-node-composer']]) {
      context.selectedLayerId.value = id
      assert.equal(await context.getCanvasNodeEditor(id, selector), editor)
    }
  }
  assert.equal(JSON.stringify(view), original)
  assert.equal(context.rightPanelVisible.value, true)
  assert.equal(saves.length, 0)
})

test('changing selection while an editor lookup is pending cancels the stale lookup', async () => {
  let resolveTick
  const member = { ...images()[0], groupId: '' }
  const context = vm.createContext({
    props: { id: 'canvas' },
    layers: { value: [member] },
    canvasNodeFocusSuspended: false,
    canvasNodeFocusRevision: 0,
    selectedLayerId: { value: 'a' },
    nextTick: () =>
      new Promise((resolve) => {
        resolveTick = resolve
      }),
    document: {
      querySelector: () => {
        throw new Error('A stale focus request must not move a grouped node')
      },
    },
  })
  load(context, 'getCanvasNodeEditor')
  const pending = context.getCanvasNodeEditor('a', '.image-node-composer')
  context.selectedLayerId.value = 'another-node'
  resolveTick()
  await pending
})
