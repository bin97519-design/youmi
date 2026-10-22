import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { parse as parseVue } from '@vue/compiler-sfc'
import { groupAtPointer } from '../src/features/canvas-v3/config/groupHover.js'

const group = (id = 'group-a', bounds = {}) => ({
  id,
  selected: false,
  bounds: { left: 100, top: 200, right: 300, bottom: 500, ...bounds },
  members: [{ id: 'image-a', rect: { left: 20, top: 20, right: 180, bottom: 220 } }],
})

test('unselected groups hover over their entire screen rectangle, including child media and edges', () => {
  const target = group()
  for (const point of [
    { x: 200, y: 350 },
    { x: 140, y: 240 },
    { x: 100, y: 200 },
    { x: 300, y: 500 },
    { x: 100, y: 350 },
    { x: 300, y: 350 },
  ])
    assert.equal(groupAtPointer([target], point), target.id)
  assert.equal(target.selected, false)
})

test('a short right-side bridge preserves hover from frame to plus without extending the whole edge', () => {
  const target = group()
  for (const point of [
    { x: 301, y: 350 },
    { x: 309, y: 350 },
    { x: 319, y: 350 },
    { x: 334, y: 350 },
    { x: 320, y: 336 },
    { x: 320, y: 364 },
  ])
    assert.equal(groupAtPointer([target], point), target.id)
  for (const point of [
    { x: 335, y: 350 },
    { x: 320, y: 335 },
    { x: 320, y: 365 },
    { x: 310, y: 220 },
    { x: 310, y: 490 },
    { x: 99, y: 350 },
    { x: 200, y: 501 },
  ])
    assert.equal(groupAtPointer([target], point), '')
})

test('last painted valid group wins overlaps, with no mutation or selection side effects', () => {
  const first = Object.freeze({ ...group('first'), bounds: Object.freeze(group().bounds) })
  const second = Object.freeze({
    ...group('second'),
    bounds: Object.freeze({ left: 200, top: 300, right: 400, bottom: 600 }),
  })
  const groups = Object.freeze([first, second])
  assert.equal(groupAtPointer(groups, { x: 250, y: 350 }), 'second')
  assert.equal(groupAtPointer([second, first], { x: 250, y: 350 }), 'first')
  assert.equal(groupAtPointer(groups, { x: 150, y: 250 }), 'first')
  assert.equal(first.selected, false)
  assert.equal(second.selected, false)
})

test('hover uses already transformed local screen bounds, never applies zoom or world coordinates again', () => {
  const small = group('small', { left: 20, top: 30, right: 70, bottom: 130 })
  small.viewport = { x: 1000, y: 2000, zoom: 0.25 }
  assert.equal(groupAtPointer([small], { x: 50, y: 80 }), 'small')
  assert.equal(groupAtPointer([small], { x: 90, y: 80 }), 'small')
  assert.equal(groupAtPointer([small], { x: 50, y: 131 }), '')
  assert.equal(groupAtPointer([small], { x: 200, y: 350 }), '')
})

test('invalid pointers, malformed bounds and missing groups do not create hover targets', () => {
  for (const point of [
    null,
    undefined,
    {},
    { x: NaN, y: 350 },
    { x: 150, y: Infinity },
    { x: '150', y: 350 },
  ])
    assert.equal(groupAtPointer([group()], point), '')
  assert.equal(groupAtPointer(null, { x: 150, y: 350 }), '')
  assert.equal(groupAtPointer({}, { x: 150, y: 350 }), '')
  assert.equal(groupAtPointer([], { x: 150, y: 350 }), '')
  for (const invalid of [
    null,
    {},
    { ...group(), id: '' },
    { ...group(), id: 123 },
    group('invalid', { left: NaN }),
    group('invalid', { top: '200' }),
    group('invalid', { right: Infinity }),
    group('invalid', { bottom: undefined }),
    group('invalid', { right: 100 }),
    group('invalid', { right: 99 }),
    group('invalid', { bottom: 200 }),
  ]) {
    assert.equal(groupAtPointer([invalid], { x: 150, y: 350 }), '')
    assert.equal(groupAtPointer([group(), invalid], { x: 150, y: 350 }), 'group-a')
  }
})

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const source = parseVue(shell).descriptor.scriptSetup.content
const ast = createRequire(import.meta.url)('@babel/parser').parse(source, { sourceType: 'module' })
const pointerHandler = ast.program.body.find(
  (node) => node.type === 'FunctionDeclaration' && node.id.name === 'handleGroupPointerMove',
)
assert.ok(pointerHandler)

function shellPointerHarness() {
  const groupHoverPoint = { value: null }
  const wrapper = { left: 80, top: 40 }
  const canvasWrap = { value: { getBoundingClientRect: () => wrapper } }
  const context = vm.createContext({ groupHoverPoint, canvasWrap })
  vm.runInContext(source.slice(pointerHandler.start, pointerHandler.end), context)
  return {
    groupHoverPoint,
    wrapper,
    canvasWrap,
    move: (event) => context.handleGroupPointerMove(event),
  }
}

test('real shell capture handler converts client coordinates to local screen coordinates without consuming media events', () => {
  const harness = shellPointerHarness()
  let consumed = 0
  harness.move({
    clientX: 230,
    clientY: 390,
    pointerType: 'mouse',
    target: { tagName: 'VIDEO' },
    preventDefault: () => consumed++,
    stopPropagation: () => consumed++,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(harness.groupHoverPoint.value)), { x: 150, y: 350 })
  assert.equal(groupAtPointer([group()], harness.groupHoverPoint.value), 'group-a')
  assert.equal(consumed, 0)
  harness.wrapper.left = 100
  harness.wrapper.top = 100
  harness.move({ clientX: 250, clientY: 450, pointerType: 'pen' })
  assert.deepEqual(JSON.parse(JSON.stringify(harness.groupHoverPoint.value)), { x: 150, y: 350 })
})

test('real shell ignores touch hover and missing canvas wrappers', () => {
  const harness = shellPointerHarness()
  const initial = { x: 10, y: 20 }
  harness.groupHoverPoint.value = initial
  harness.move({ clientX: 230, clientY: 390, pointerType: 'touch' })
  assert.equal(harness.groupHoverPoint.value, initial)
  harness.canvasWrap.value = null
  harness.move({ clientX: 230, clientY: 390, pointerType: 'mouse' })
  assert.equal(harness.groupHoverPoint.value, initial)
})

test('shell observes pointer movement in capture phase, clears it on leaving and passes hover state to frames', () => {
  assert.match(shell, /@pointermove\.capture="handleGroupPointerMove"/)
  assert.match(shell, /@pointerleave="groupHoverPoint = null"/)
  assert.match(shell, /:pointer-inside="hoveredGroupId === group.id"/)
  assert.match(
    shell,
    /const hoveredGroupId = computed\(\(\) => groupAtPointer\(selectionGroups.value, groupHoverPoint.value\)\)/,
  )
})
