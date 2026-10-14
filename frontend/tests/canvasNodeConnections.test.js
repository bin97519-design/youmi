import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import {
  selectedConnectionImages,
  selectedConnectionMedia,
  selectionBounds,
  missingNodeConnections,
  incomingImageReferences,
} from '../src/utils/canvasNodeConnections.js'
import {
  normalizeImageNodeDraft,
  syncImageNodeConnectedReferences,
} from '../src/utils/imageNodeDraft.js'

const images = ['a', 'b', 'c'].map((id, index) => ({
  id,
  type: 'image',
  url: `/${id}.png`,
  x: 30,
  y: index * 120,
  width: 100,
  height: 100,
}))
const edge = (fromLayerId, toLayerId, fromPort = 'right', toPort = 'left') => ({
  fromLayerId,
  toLayerId,
  fromPort,
  toPort,
})
const models = ['model-a']
const videos = images.map((image) => ({ ...image, type: 'video', url: `/${image.id}.mp4` }))

test('grouped videos expose the shared connector in visual order, including rendered legacy nodes', () => {
  assert.deepEqual(
    selectedConnectionMedia(videos, ['c', 'a', 'b', 'a']).map((item) => item.id),
    ['a', 'b', 'c'],
  )
  const legacy = videos.map((video) => ({ ...video, visible: false, locked: true }))
  assert.equal(selectedConnectionMedia(legacy, ['a', 'b', 'c']).length, 0)
  assert.equal(selectedConnectionMedia(legacy, ['a', 'b', 'c'], new Set(['a', 'b', 'c'])).length, 3)
  assert.equal(selectedConnectionMedia(legacy, ['a', 'b', 'c'], new Set(['a', 'b'])).length, 0)
  assert.deepEqual(selectedConnectionImages(videos, ['a', 'b', 'c']), [])
})

test('the shared connector supports mixed types and returned videos while rejecting missing results', () => {
  assert.deepEqual(selectedConnectionMedia(videos, ['a']), [])
  assert.deepEqual(selectedConnectionMedia(videos, ['a', 'missing']), [])
  for (const patch of [{ url: '' }, { url: 'blob:temporary' }, { type: 'placeholder' }, { type: 'image', generating: true }]) {
    const layers = [videos[0], { ...videos[1], ...patch }]
    assert.deepEqual(selectedConnectionMedia(layers, ['a', 'b']), [])
    assert.deepEqual(selectedConnectionMedia(layers, ['b', 'a']), [])
  }
  for (const patch of [{ type: 'image', url: '/image.png' }, { type: 'text', text: 'Script' }, { generating: true, status: 'processing' }]) {
    const layers = [videos[0], { ...videos[1], ...patch }]
    assert.equal(selectedConnectionMedia(layers, ['a', 'b']).length, 2)
    assert.equal(selectedConnectionMedia(layers, ['b', 'a']).length, 2)
    assert.deepEqual(selectedConnectionImages(layers, ['a', 'b']), [])
  }
  assert.equal(selectedConnectionMedia(images, ['a', 'b', 'c']).length, 3)
})

test('bundled video edges do not become image references for image or video generation', () => {
  const target = { id: 'target', type: 'video', url: '' }
  const edges = missingNodeConnections(['a', 'b', 'c'], 'right', target.id, 'left', [])
  assert.equal(edges.length, 3)
  assert.deepEqual(incomingImageReferences([...videos, target], edges, target.id), [])
  assert.deepEqual(
    incomingImageReferences([...videos, images[0], target], [edge('b', target.id)], target.id),
    [],
  )
})

test('grouped image selection follows visual order, excludes invalid selections, and does not require unlocked sources', () => {
  assert.deepEqual(
    selectedConnectionImages(images, ['c', 'a', 'b', 'a']).map((item) => item.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(selectedConnectionImages(images, ['a']), [])
  assert.deepEqual(selectedConnectionImages(images, ['a', 'missing']), [])
  for (const patch of [
    { type: 'video' },
    { type: 'placeholder' },
    { url: '' },
    { visible: false },
    { generating: true },
  ])
    assert.deepEqual(
      selectedConnectionImages([images[0], { ...images[1], ...patch }], ['a', 'b']),
      [],
    )
  assert.equal(
    selectedConnectionImages([{ ...images[0], locked: true }, images[1]], ['a', 'b']).length,
    2,
  )
  assert.deepEqual(selectionBounds(images, 10), {
    left: 20,
    top: -10,
    right: 140,
    bottom: 350,
    width: 120,
    height: 360,
  })
  assert.equal(selectionBounds([]), null)
})

test('old hidden flags do not prevent grouped connections or references for actually rendered images', () => {
  const layers = images.map((image) => ({ ...image, visible: false }))
  const rendered = new Set(['a', 'b', 'c', 'video'])
  assert.equal(selectedConnectionImages(layers, ['a', 'b', 'c']).length, 0)
  assert.equal(selectedConnectionImages(layers, ['a', 'b', 'c'], rendered).length, 3)
  assert.equal(selectedConnectionImages(layers, ['a', 'b', 'c'], new Set(['a', 'b'])).length, 0)
  const edges = [edge('a', 'video'), edge('b', 'video'), edge('c', 'video')]
  assert.equal(incomingImageReferences(layers, edges, 'video', rendered).length, 3)
  assert.deepEqual(
    incomingImageReferences(layers, edges, 'video', new Set(['a', 'video'])).map(
      (reference) => reference.layerId,
    ),
    ['a'],
  )
  assert.ok(layers.every((layer) => layer.visible === false))
})

test('batch edges cannot connect to their own group or duplicate existing port pairs', () => {
  assert.deepEqual(missingNodeConnections(['a', 'b'], 'right', 'b', 'left', []), [])
  const edges = missingNodeConnections(['a', 'a', 'b', 'c'], 'right', 'video', 'left', [
    edge('b', 'video'),
  ])
  assert.deepEqual(edges, [edge('a', 'video'), edge('c', 'video')])
})

test('references reflect incoming edges and reverse input-port connections without duplicates or non-image sources', () => {
  const layers = [
    ...images,
    { ...images[0], id: 'duplicate' },
    { id: 'video', type: 'video', url: '/video.mp4' },
  ]
  const refs = incomingImageReferences(
    layers,
    [
      edge('a', 'video'),
      edge('duplicate', 'video'),
      edge('video', 'b', 'left', 'right'),
      edge('missing', 'video'),
      edge('video', 'video'),
    ],
    'video',
  )
  assert.deepEqual(
    refs.map((item) => item.layerId),
    ['a', 'b'],
  )
})

test('image graph synchronization retains prompt, configuration and uploaded references while removing disconnected sources', () => {
  const initial = normalizeImageNodeDraft(
    {
      prompt: 'Preserve this prompt',
      config: { model: 'model-a', ratio: '3:4', resolution: '4K', count: 2 },
      references: [{ url: '/upload.png', id: 'upload' }],
    },
    {},
    models,
  )
  const connected = syncImageNodeConnectedReferences(
    initial,
    images.map((image) => ({ ...image, layerId: image.id })),
    models,
  )
  assert.deepEqual(connected.connectedLayerIds, ['a', 'b', 'c'])
  assert.equal(connected.references.length, 4)
  const disconnected = syncImageNodeConnectedReferences(
    connected,
    [{ url: '/b-new.png', layerId: 'b' }],
    models,
  )
  assert.deepEqual(
    disconnected.references.map((item) => item.url),
    ['/upload.png', '/b-new.png'],
  )
  assert.equal(disconnected.prompt, initial.prompt)
  assert.deepEqual(disconnected.config, initial.config)
  assert.deepEqual(
    initial.references.map((item) => item.url),
    ['/upload.png'],
  )
})

const require = createRequire(import.meta.url)
const { parse } = createRequire(require.resolve('@vue/compiler-sfc'))('@babel/parser')
const script = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const nodes = parse(script, { sourceType: 'module' }).program.body
function load(context, name) {
  const node = nodes.find((item) => item.type === 'FunctionDeclaration' && item.id?.name === name)
  assert.ok(node)
  vm.runInContext(script.slice(node.start, node.end), context)
}

test('actual batch connection helper creates one undo step and saves all edges together', () => {
  const connections = { value: [] },
    snapshots = [],
    saves = []
  const context = vm.createContext({
    layers: { value: [...images, { id: 'video', type: 'video' }] },
    connections,
    missingNodeConnections,
    pushUndo: () => snapshots.push(structuredClone(connections.value)),
    persistConnections: () => saves.push(structuredClone(connections.value)),
    debounceSaveLayout: () => {},
    nextTick: (callback) => callback(),
    refreshConnections: () => {},
  })
  load(context, 'addNodeConnections')
  assert.equal(
    context.addNodeConnections(['a', 'b', 'c'], 'right', 'video', 'left', { grouped: true }),
    3,
  )
  assert.equal(snapshots.length, 1)
  assert.equal(saves.length, 1)
  assert.equal(saves[0].length, 3)
  assert.equal(new Set(connections.value.map((item) => item.bundleId)).size, 1)
  assert.equal(
    context.addNodeConnections(['a', 'b', 'c'], 'right', 'video', 'left', { grouped: true }),
    0,
  )
  assert.equal(snapshots.length, 1)
  assert.equal(context.addNodeConnections(['missing'], 'right', 'video', 'left'), 0)
  assert.equal(context.addNodeConnections(['a'], 'right', 'missing', 'left'), 0)
  connections.value = [{ ...edge('b', 'video'), id: 'existing-edge' }]
  snapshots.length = saves.length = 0
  assert.equal(
    context.addNodeConnections(['a', 'b', 'c'], 'right', 'video', 'left', { grouped: true }),
    2,
  )
  assert.equal(connections.value.length, 3)
  assert.equal(new Set(connections.value.map((item) => item.bundleId)).size, 1)
  assert.equal(connections.value[0].id, 'existing-edge')
  assert.equal(snapshots[0][0].bundleId, undefined)
  assert.equal(
    context.addNodeConnections(['a', 'b', 'c'], 'right', 'video', 'left', { grouped: true }),
    0,
  )
  assert.equal(snapshots.length, 1)
})

test('actual grouped drop detection accepts node bodies, rejects self, locked and busy nodes, and preserves single-port behavior', () => {
  const target = { id: 'video', type: 'video' },
    self = images[0]
  let current = target,
    isPort = false,
    busy = false
  const element = {
    closest: (selector) =>
      selector === '.canvas-layer'
        ? { dataset: { layerId: current.id } }
        : selector === '.uc-connection-port' && isPort
          ? { classList: { contains: () => true } }
          : null,
  }
  const context = vm.createContext({
    document: { elementFromPoint: () => element },
    layers: { value: [...images, target] },
    connecting: { grouped: true, sourceLayerIds: ['a', 'b', 'c'] },
    isEditableImageNode: (layer) => layer.type === 'image' && !layer.generating,
    videoNodeBusy: () => busy,
    inlineDialogModification: { layerId: '' },
    inlineDialogUploading: { value: false },
  })
  load(context, 'connectionDropTarget')
  assert.equal(context.connectionDropTarget(0, 0).layerId, 'video')
  current = self
  assert.equal(context.connectionDropTarget(0, 0), null)
  current = target
  target.locked = true
  assert.equal(context.connectionDropTarget(0, 0), null)
  target.locked = false
  busy = true
  assert.equal(context.connectionDropTarget(0, 0), null)
  busy = false
  context.connecting.grouped = false
  assert.equal(context.connectionDropTarget(0, 0), null)
  isPort = true
  assert.equal(context.connectionDropTarget(0, 0).port, 'left')
})

test('batch undo snapshots optionally retain group selection without changing ordinary undo snapshots', () => {
  const context = vm.createContext({
    doc: { value: { payload: { layers: images } } },
    connections: { value: [] },
    undoStack: { value: [] },
    layerDetectedElements: { value: {} },
    selectedDetectedElements: { value: new Set() },
    selectedLayerIds: { value: ['a', 'b', 'c'] },
    selectedLayerId: { value: 'c' },
  })
  load(context, 'pushUndo')
  context.pushUndo({ restoreSelection: true })
  assert.deepEqual(JSON.parse(JSON.stringify(context.undoStack.value[0].selection)), {
    ids: ['a', 'b', 'c'],
    primary: 'c',
  })
  context.pushUndo()
  assert.equal(context.undoStack.value[1].selection, undefined)
})

test('converging lines measure their shared destination port only once per render', () => {
  const measured = []
  const context = vm.createContext({
    connectionTick: { value: 1 },
    connections: { value: images.map((image) => edge(image.id, 'video')) },
    renderedLayerIds: { value: new Set(['a', 'b', 'c', 'video']) },
    getPortPosition: (id, port) => {
      measured.push([id, port])
      return { x: 0, y: 0 }
    },
    generateCurvePath: () => 'M 0 0 C 1 1 2 2 3 3',
  })
  load(context, 'getConnectionPaths')
  assert.equal(context.getConnectionPaths().length, 3)
  assert.equal(measured.length, 4)
  assert.equal(measured.filter(([id]) => id === 'video').length, 1)
})
