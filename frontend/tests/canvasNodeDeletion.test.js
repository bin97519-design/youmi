import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import { archiveCanvasAssetDeletion } from '../src/utils/canvasAssetTrash.js'

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
  assert.ok(node, `Missing function ${name}`)
  vm.runInContext(source.slice(node.start, node.end), context)
}

function deletionContext(ids = ['b'], primary = 'b') {
  const payload = {
    layers: [
      { id: 'a', type: 'image', url: '/a.png', x: -4000, y: 2800, width: 200, height: 267 },
      { id: 'b', type: 'image', url: '/b.png', x: 250, y: 180, width: 200, height: 267 },
      { id: 'c', type: 'video', url: '/c.mp4', x: 600, y: 180, width: 200, height: 267 },
    ],
    view: { scale: 0.23, offset: { x: 682, y: 112 } },
    connections: [{ fromLayerId: 'b', toLayerId: 'c' }],
    detectedElements: { b: [{ id: 'element' }] },
  }
  const ticks = [],
    snapshots = [],
    saves = []
  const context = vm.createContext({
    payload,
    props: { id: 'test-canvas' },
    doc: { value: { payload } },
    layers: {
      get value() {
        return payload.layers
      },
    },
    userStore: { requireLogin: () => true },
    textNodeActivity: {},
    textNodeRequests: new Map(),
    selectedLayerIds: { value: [...ids] },
    selectedLayerId: { value: primary },
    playingVideoLayerId: { value: 'c' },
    inlineDialogModification: { layerId: 'b', text: 'draft', models: ['model'] },
    expandedLayerToolbarId: { value: 'b' },
    connections: { value: structuredClone(payload.connections) },
    layerDetectedElements: { value: { ...payload.detectedElements } },
    selectedDetectedElements: { value: new Set(['b::element', 'a::keep']) },
    elementClickPositions: { value: { 'b::element': { x: 1, y: 1 }, 'a::keep': { x: 2, y: 2 } } },
    keyboardSelectionTarget: { value: 'layer' },
    canvasNodeFocusRevision: 0,
    canvasNodeFocusSuspended: false,
    nextTick: (callback) => {
      ticks.push(callback)
      return Promise.resolve()
    },
    pushUndo: () => snapshots.push(JSON.stringify(payload)),
    archiveCanvasAssetDeletion,
    canvas: {
      updateDocument: (_, mutate) => mutate({ payload }),
      flushNow: (id) => saves.push(id),
    },
  })
  load(context, 'cancelTextNodeRequest')
  load(context, 'removeLayers')
  return {
    context,
    payload,
    snapshots,
    saves,
    flush: () => {
      for (const callback of ticks.splice(0)) callback?.()
    },
    ticks,
  }
}

test('deleting the selected node clears selection without jumping to the faraway first image', () => {
  const { context, payload, snapshots, saves, flush } = deletionContext()
  const view = JSON.stringify(payload.view),
    remaining = JSON.stringify([payload.layers[0], payload.layers[2]])
  context.removeLayers(['b'])
  assert.equal(JSON.stringify(payload.view), view)
  assert.equal(JSON.stringify(payload.layers), remaining)
  assert.equal(context.selectedLayerId.value, '')
  assert.deepEqual([...context.selectedLayerIds.value], [])
  assert.equal(context.canvasNodeFocusSuspended, true)
  assert.equal(snapshots.length, 1)
  assert.equal(saves.length, 1)
  assert.equal(payload.deletedAssetBatches[0].entries[0].layer.id, 'b')
  assert.equal(context.connections.value.length, 0)
  assert.equal(context.layerDetectedElements.value.b, undefined)
  assert.deepEqual([...context.selectedDetectedElements.value], ['a::keep'])
  assert.equal(context.elementClickPositions.value['b::element'], undefined)
  flush()
  assert.equal(context.canvasNodeFocusSuspended, false)
})

test('deleting an unrelated node preserves the current selected node and viewport', () => {
  const { context, payload, flush } = deletionContext()
  const view = JSON.stringify(payload.view)
  context.removeLayers(['a'])
  assert.equal(context.selectedLayerId.value, 'b')
  assert.deepEqual([...context.selectedLayerIds.value], ['b'])
  assert.equal(JSON.stringify(payload.view), view)
  flush()
})

test('partial batch deletion retains surviving selections and chooses only an already selected primary', () => {
  const { context, payload, flush } = deletionContext(['b', 'c'], 'b')
  const view = JSON.stringify(payload.view)
  context.removeLayers(['b', 'unknown', 'b'])
  assert.deepEqual([...context.selectedLayerIds.value], ['c'])
  assert.equal(context.selectedLayerId.value, 'c')
  assert.equal(JSON.stringify(payload.view), view)
  flush()
})

test('deleting the last nodes does not reset zoom or offset', () => {
  const { context, payload, flush } = deletionContext(['a', 'b', 'c'], 'c')
  const view = JSON.stringify(payload.view)
  context.removeLayers(['a', 'b', 'c'])
  assert.equal(payload.layers.length, 0)
  assert.equal(context.playingVideoLayerId.value, null)
  assert.equal(context.selectedLayerId.value, '')
  assert.equal(JSON.stringify(payload.view), view)
  flush()
})

test('unknown IDs or missing login do not suspend focus or modify selection/document', () => {
  const { context, payload, snapshots } = deletionContext()
  const before = JSON.stringify(payload)
  context.removeLayers(['unknown'])
  context.userStore.requireLogin = () => false
  context.removeLayers(['b'])
  assert.equal(JSON.stringify(payload), before)
  assert.equal(context.canvasNodeFocusSuspended, false)
  assert.equal(context.canvasNodeFocusRevision, 0)
  assert.equal(snapshots.length, 0)
})

test('deletion cancels an already queued editor focus even if its selected node survives', async () => {
  const { context, payload } = deletionContext()
  let releaseFocus
  context.nextTick = (callback) =>
    callback
      ? Promise.resolve().then(callback)
      : new Promise((resolve) => {
          releaseFocus = resolve
        })
  context.document = {
    querySelector: () => assert.fail('Cancelled focus must not measure or move the viewport'),
  }
  load(context, 'getCanvasNodeEditor')
  const view = JSON.stringify(payload.view)
  const pending = context.getCanvasNodeEditor('b', '.image-node-composer')
  context.removeLayers(['a'])
  releaseFocus()
  await pending
  assert.equal(JSON.stringify(payload.view), view)
})

test('suspended editor focus exits without scheduling a viewport change', async () => {
  const { context, payload } = deletionContext()
  context.canvasNodeFocusSuspended = true
  context.nextTick = () => assert.fail('Must not schedule focus during deletion')
  const before = JSON.stringify(payload.view)
  load(context, 'getCanvasNodeEditor')
  await context.getCanvasNodeEditor('b', '.image-node-composer')
  assert.equal(JSON.stringify(payload.view), before)
})

test('deletion cancels a queued video-prompt focus without moving to its surviving text node', async () => {
  const { context, payload } = deletionContext()
  payload.layers[1].type = 'text'
  let releaseFocus
  context.nextTick = (callback) =>
    callback
      ? Promise.resolve().then(callback)
      : new Promise((resolve) => {
          releaseFocus = resolve
        })
  context.selectSingleLayer = (layer) => {
    context.selectedLayerId.value = layer.id
    context.selectedLayerIds.value = [layer.id]
  }
  context.revealCanvasMedia = () => {}
  context.document = {
    querySelector: () => assert.fail('Cancelled prompt focus must not measure the viewport'),
  }
  load(context, 'focusVideoPromptNode')
  const view = JSON.stringify(payload.view)
  const pending = context.focusVideoPromptNode('b')
  context.removeLayers(['a'])
  releaseFocus()
  await pending
  assert.equal(JSON.stringify(payload.view), view)
})

test('the actual image selection watcher opens a remaining editor without auto-focusing it during deletion', () => {
  const { context, flush, ticks } = deletionContext(['a', 'b'], 'b')
  const watcher = ast.program.body.find(
    (node) =>
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression' &&
      node.expression.callee.name === 'watch' &&
      node.expression.arguments[1]?.type === 'ArrowFunctionExpression' &&
      source
        .slice(node.expression.arguments[1].start, node.expression.arguments[1].end)
        .includes('activateImageNodeEditor(layer)'),
  )
  assert.ok(watcher)
  const callback = watcher.expression.arguments[1]
  context.selectedLayer = {
    get value() {
      return context.layers.value.find((layer) => layer.id === context.selectedLayerId.value)
    },
  }
  context.activeImageNodeCanvasId = 'test-canvas'
  context.activateImageNodeEditor = (layer) => {
    context.inlineDialogModification.layerId = layer?.id || ''
  }
  context.isImageNodeEditorVisible = () => true
  vm.runInContext(
    `globalThis.runSelectionWatcher = ${source.slice(callback.start, callback.end)}`,
    context,
  )
  context.removeLayers(['b'])
  context.runSelectionWatcher()
  assert.equal(context.inlineDialogModification.layerId, 'a')
  assert.equal(ticks.length, 1)
  flush()
})
