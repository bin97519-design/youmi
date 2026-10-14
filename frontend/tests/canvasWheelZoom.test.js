import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'

const require = createRequire(import.meta.url)
const { parse } = createRequire(require.resolve('@vue/compiler-sfc'))('@babel/parser')
const script = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const nodes = parse(script, { sourceType: 'module' }).program.body

function fixture(scale = 0.6) {
  const view = { scale, offset: { x: 40, y: 50 } }
  const calls = { updates: 0, refreshes: 0, closes: 0 }
  const stage = { getBoundingClientRect: () => ({ left: 100, top: 200 }) }
  const context = vm.createContext({
    document: { querySelector: () => stage },
    props: { id: 'canvas' },
    ZOOM_MIN: 0.1,
    ZOOM_MAX: 4,
    canvas: {
      updateDocument: (id, callback) => {
        assert.equal(id, 'canvas')
        calls.updates++
        callback({ payload: { view } })
      },
    },
    closeConnectionNodeMenu: () => calls.closes++,
    nextTick: (callback) => callback(),
    refreshConnections: () => calls.refreshes++,
  })
  for (const name of [
    'zoom',
    'wheelZoom',
    'handleCanvasZoomWheel',
    'handleCanvasScrollableWheel',
  ]) {
    const node = nodes.find((item) => item.type === 'FunctionDeclaration' && item.id?.name === name)
    assert.ok(node)
    vm.runInContext(script.slice(node.start, node.end), context)
  }
  const event = (patch = {}) => ({
    ctrlKey: false,
    metaKey: false,
    deltaX: 0,
    deltaY: -120,
    clientX: 350,
    clientY: 550,
    currentTarget: {},
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...patch,
  })
  return { context, view, calls, stage, event }
}

test('the capture handler leaves ordinary scrolling untouched', () => {
  const { context, view, calls, event } = fixture()
  const wheel = event()
  context.handleCanvasZoomWheel(wheel)
  assert.equal(wheel.prevented, false)
  assert.equal(wheel.stopped, false)
  assert.equal(calls.updates, 0)
  assert.equal(calls.closes, 0)
  assert.equal(view.scale, 0.6)
})

test('Ctrl and Cmd wheel cancel page zoom and zoom the canvas exactly once around the cursor', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const { context, view, calls, event } = fixture()
    const wheel = event({ [modifier]: true })
    const world = { x: (250 - view.offset.x) / view.scale, y: (350 - view.offset.y) / view.scale }
    context.handleCanvasZoomWheel(wheel)
    assert.equal(wheel.prevented, true)
    assert.equal(wheel.stopped, true)
    assert.equal(view.scale, 0.65)
    assert.equal(calls.updates, 1)
    assert.equal(calls.refreshes, 1)
    assert.ok(Math.abs(world.x * view.scale + view.offset.x - 250) <= 0.5)
    assert.ok(Math.abs(world.y * view.scale + view.offset.y - 350) <= 0.5)
  }
})

test('stage and nested targets use the same canvas origin as the window capture listener', () => {
  for (const source of ['stage', 'nested', 'editor', 'window']) {
    const { context, view, stage, event } = fixture()
    const currentTarget =
      source === 'stage' || source === 'nested'
        ? { closest: () => stage }
        : source === 'editor'
          ? { closest: () => null, querySelector: () => stage }
          : {}
    context.handleCanvasZoomWheel(event({ ctrlKey: true, deltaY: 120, currentTarget }))
    assert.equal(view.scale, 0.55)
    assert.deepEqual(JSON.parse(JSON.stringify(view.offset)), {
      x: Math.round(250 - 350 * 0.55),
      y: 75,
    })
  }
})

test('canvas zoom limits remain bounded and horizontal-only Ctrl wheel cannot accidentally zoom in', () => {
  for (const [scale, deltaY] of [
    [0.1, 120],
    [4, -120],
  ]) {
    const { context, view, event } = fixture(scale)
    context.handleCanvasZoomWheel(event({ ctrlKey: true, deltaY }))
    assert.equal(view.scale, scale)
  }
  const { context, view, calls, event } = fixture()
  const wheel = event({ ctrlKey: true, deltaX: 120, deltaY: 0 })
  context.handleCanvasZoomWheel(wheel)
  assert.equal(wheel.prevented, true)
  assert.equal(wheel.stopped, true)
  assert.equal(view.scale, 0.6)
  assert.equal(calls.updates, 0)
})

test('ordinary stage wheel still pans, while a scrollable editor keeps its native scroll behavior', () => {
  const { context, view, calls, event } = fixture()
  const stageWheel = event({ deltaX: 15, deltaY: 35 })
  context.wheelZoom(stageWheel)
  assert.equal(stageWheel.prevented, true)
  assert.deepEqual(JSON.parse(JSON.stringify(view.offset)), { x: 25, y: 15 })
  assert.equal(view.scale, 0.6)
  const editorWheel = event({ deltaY: 35 })
  context.handleCanvasScrollableWheel(editorWheel)
  assert.equal(editorWheel.stopped, true)
  assert.equal(editorWheel.prevented, false)
  assert.equal(calls.updates, 1)
})

test('the non-passive wheel capture listener is removed when leaving the canvas editor', () => {
  assert.match(
    script,
    /addEventListener\('wheel', handleCanvasZoomWheel, \{ capture: true, passive: false \}\)/,
  )
  assert.match(script, /removeEventListener\('wheel', handleCanvasZoomWheel, true\)/)
})
