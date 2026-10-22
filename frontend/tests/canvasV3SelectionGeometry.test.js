import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasSelectionBounds,
  selectionToolbarPlacement,
  selectionMenuPlacement,
} from '../src/features/canvas-v3/config/selectionGeometry.js'
import { nodeSize } from '../src/features/canvas-v3/config/nodeGeometry.js'

const nodes = [
  {
    id: 'a',
    position: { x: -200, y: 140 },
    data: { kind: 'image', assetUrl: 'a.png', mediaWidth: 800, mediaHeight: 400 },
  },
  {
    id: 'b',
    position: { x: 700, y: -80 },
    data: { kind: 'video', assetUrl: 'b.mp4', mediaWidth: 400, mediaHeight: 800 },
  },
]
const viewport = { width: 1920, height: 1080 }

test('selection bounds use actual mixed-media dimensions and screen padding, without mutating nodes', () => {
  const before = structuredClone(nodes)
  const bounds = canvasSelectionBounds(nodes, { x: 50, y: 100, zoom: 1 }, 24)
  assert.equal(bounds.left, -200 + 50 - 24)
  assert.equal(bounds.top, -80 + 100 - 24)
  assert.equal(bounds.right, 700 + nodeSize('video', nodes[1].data).width + 50 + 24)
  assert.equal(bounds.bottom, 140 + nodeSize('image', nodes[0].data).height + 100 + 24)
  assert.equal(bounds.centerX, (bounds.left + bounds.right) / 2)
  assert.equal(bounds.width, bounds.right - bounds.left)
  assert.deepEqual(nodes, before)
})

test('zoom scales only node geometry while frame padding remains constant in screen pixels', () => {
  for (const zoom of [0.2, 0.46, 1, 2, 8]) {
    const raw = canvasSelectionBounds(nodes, { x: 10, y: 20, zoom }, 0)
    const padded = canvasSelectionBounds(nodes, { x: 10, y: 20, zoom }, 24)
    assert.equal(raw.left - padded.left, 24)
    assert.equal(padded.right - raw.right, 24)
    assert.equal(raw.top - padded.top, 24)
    assert.equal(padded.bottom - raw.bottom, 24)
  }
})

test('panning moves frame and un-clamped toolbar equally without scaling its 644x50 controls', () => {
  const first = canvasSelectionBounds(nodes, { x: 700, y: 350, zoom: 0.5 })
  const second = canvasSelectionBounds(nodes, { x: 750, y: 380, zoom: 0.5 })
  assert.equal(second.left - first.left, 50)
  assert.equal(second.top - first.top, 30)
  const one = selectionToolbarPlacement(first, { width: 644, height: 50 }, viewport)
  const two = selectionToolbarPlacement(second, { width: 644, height: 50 }, viewport)
  assert.equal(two.left - one.left, 50)
  assert.equal(two.top - one.top, 30)
  assert.equal(one.width, 644)
  assert.equal(one.height, 50)
  assert.equal(one.top, first.top - 60)
  assert.equal(Object.hasOwn(one, 'transform'), false)
})

test('empty, singleton, hidden, malformed coordinates or invalid zoom do not create ghost frames', () => {
  for (const value of [
    [],
    [nodes[0]],
    null,
    [nodes[0], { ...nodes[1], hidden: true }],
    [nodes[0], { ...nodes[1], position: { x: NaN, y: 1 } }],
  ])
    assert.equal(canvasSelectionBounds(value, { zoom: 1 }), null)
  for (const zoom of [0, -1, Infinity, NaN, '1'])
    assert.equal(canvasSelectionBounds(nodes, { zoom }), null)
  const rotated = [{ ...nodes[0], data: { ...nodes[0].data, rotation: 90 } }, nodes[1]]
  const result = canvasSelectionBounds(rotated, { zoom: 1 }, 0)
  assert.equal(result.bottom, Math.max(140 + 350, -80 + 350))
})

test('toolbar defaults above, flips below near top, and clamps narrow viewports instead of zooming', () => {
  const center = { left: 700, right: 1100, top: 300, bottom: 650 }
  const ordinary = selectionToolbarPlacement(center, { width: 644, height: 50 }, viewport)
  assert.deepEqual(ordinary, {
    left: 578,
    top: 240,
    width: 644,
    height: 50,
    maxWidth: 1904,
    side: 'above',
  })
  const top = selectionToolbarPlacement(
    { ...center, top: 20, bottom: 200 },
    { width: 644, height: 50 },
    viewport,
  )
  assert.equal(top.side, 'below')
  assert.equal(top.top, 210)
  const narrow = selectionToolbarPlacement(
    center,
    { width: 644, height: 50 },
    { width: 320, height: 720 },
  )
  assert.equal(narrow.left, 8)
  assert.equal(narrow.width, 304)
  assert.equal(narrow.height, 50)
  const offscreen = selectionToolbarPlacement(
    { left: -8000, right: -7000, top: -500, bottom: 5000 },
    {},
    { width: 320, height: 400 },
  )
  assert.equal(offscreen.left, 8)
  assert.equal(offscreen.top, 8)
})

test('menus use observed upper/lower sides and independently clamp within all viewport edges', () => {
  const anchor = { left: 800, right: 830, top: 400, bottom: 450 }
  const layout = selectionMenuPlacement(anchor, { width: 120, height: 132 }, viewport, 'above')
  assert.deepEqual(layout, {
    left: 800,
    top: 262,
    width: 120,
    height: 132,
    maxHeight: 1064,
    side: 'above',
  })
  const group = selectionMenuPlacement(anchor, { width: 150, height: 80 }, viewport, 'below')
  assert.equal(group.top, 456)
  assert.equal(group.side, 'below')
  const flipped = selectionMenuPlacement(
    { ...anchor, top: 970, bottom: 1020 },
    { width: 150, height: 80 },
    viewport,
  )
  assert.equal(flipped.side, 'above')
  assert.equal(flipped.top, 884)
  const narrow = selectionMenuPlacement(
    { left: 600, right: 640, top: -100, bottom: -50 },
    { width: 150, height: 132 },
    { width: 120, height: 100 },
    'above',
  )
  assert.equal(narrow.left, 8)
  assert.equal(narrow.width, 104)
  assert.equal(narrow.top, 8)
  assert.equal(narrow.height, 84)
})

test('invalid viewport or bounds never yield NaN styles', () => {
  for (const bounds of [
    null,
    {},
    { left: NaN, right: 30, top: 20, bottom: 50 },
    { left: 30, right: 20, top: 0, bottom: 5 },
  ])
    assert.equal(selectionToolbarPlacement(bounds, {}, viewport), null)
  for (const view of [
    {},
    { width: 0, height: 10 },
    { width: Infinity, height: 100 },
    { width: 100, height: -1 },
  ]) {
    assert.equal(
      selectionToolbarPlacement({ left: 1, right: 10, top: 2, bottom: 20 }, {}, view),
      null,
    )
    assert.equal(selectionMenuPlacement({ left: 1, right: 10, top: 2, bottom: 20 }, {}, view), null)
  }
})
