import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasGroupBounds,
  resizeGroupPadding,
} from '../src/features/canvas-v3/config/groupGeometry.js'
import {
  DEFAULT_GROUP_PADDING,
  MAX_GROUP_PADDING,
  normalizedGroupPadding,
  isGroupPadding,
} from '../src/features/canvas-v3/config/groupAppearance.js'

const members = () => [
  {
    position: { x: 100, y: 200 },
    data: {
      kind: 'image',
      assetUrl: 'https://example.com/a.png',
      mediaWidth: 100,
      mediaHeight: 100,
    },
  },
  {
    position: { x: 600, y: 700 },
    data: {
      kind: 'video',
      assetUrl: 'https://example.com/a.mp4',
      mediaWidth: 100,
      mediaHeight: 100,
    },
  },
]

test('persistent group bounds use 80 world-unit padding, not 24 fixed screen pixels', () => {
  const nodes = members()
  assert.deepEqual(canvasGroupBounds(nodes, { x: 10, y: 20, zoom: 0.5 }), {
    left: 20,
    top: 80,
    right: 525,
    bottom: 585,
    width: 505,
    height: 505,
    centerX: 272.5,
    centerY: 332.5,
  })
  const atOne = canvasGroupBounds(nodes, { x: 0, y: 0, zoom: 1 })
  assert.equal(atOne.left, 20)
  assert.equal(atOne.top, 120)
  assert.equal(atOne.right, 1030)
  assert.equal(atOne.bottom, 1130)
})

test('group geometry uses persisted per-side padding and does not change any media data or world position', () => {
  const nodes = members()
  nodes[0].data.groupPadding = { top: 16, right: 32, bottom: 48, left: 64 }
  const before = JSON.stringify(nodes)
  const bounds = canvasGroupBounds(nodes, { zoom: 1 })
  assert.deepEqual([bounds.left, bounds.top, bounds.right, bounds.bottom], [36, 184, 982, 1098])
  assert.equal(JSON.stringify(nodes), before)
  assert.deepEqual(
    canvasGroupBounds(nodes, { zoom: 1 }, DEFAULT_GROUP_PADDING),
    canvasGroupBounds(members(), { zoom: 1 }),
  )
})

test('invalid geometry is hidden; malformed padding falls back safely', () => {
  assert.equal(canvasGroupBounds([], {}), null)
  assert.equal(canvasGroupBounds([members()[0]], {}), null)
  assert.equal(canvasGroupBounds(members(), { zoom: 0 }), null)
  assert.equal(canvasGroupBounds(members(), { zoom: NaN }), null)
  const nodes = members()
  nodes[1].hidden = true
  assert.equal(canvasGroupBounds(nodes, {}), null)
  assert.deepEqual(
    normalizedGroupPadding({ top: -1, right: 20, bottom: 20, left: 20 }),
    DEFAULT_GROUP_PADDING,
  )
  assert.equal(isGroupPadding({ top: 80, right: 80, bottom: 80, left: 80, other: 1 }), false)
})

for (const [corner, expected] of [
  ['nw', { top: 60, right: 80, bottom: 80, left: 70 }],
  ['ne', { top: 60, right: 90, bottom: 80, left: 80 }],
  ['sw', { top: 80, right: 80, bottom: 100, left: 70 }],
  ['se', { top: 80, right: 90, bottom: 100, left: 80 }],
]) {
  test(`${corner} updates only its two sides and leaves the supplied padding immutable`, () => {
    const padding = { ...DEFAULT_GROUP_PADDING }
    assert.deepEqual(resizeGroupPadding(padding, corner, 10, 20), expected)
    assert.deepEqual(padding, DEFAULT_GROUP_PADDING)
  })
}

test('corner resize clamps at min16/max100000 and rejects bad corner or deltas', () => {
  assert.deepEqual(resizeGroupPadding(DEFAULT_GROUP_PADDING, 'nw', 1000, 1000), {
    top: 16,
    right: 80,
    bottom: 80,
    left: 16,
  })
  assert.deepEqual(resizeGroupPadding(DEFAULT_GROUP_PADDING, 'se', 1e8, 1e8), {
    top: 80,
    right: MAX_GROUP_PADDING,
    bottom: MAX_GROUP_PADDING,
    left: 80,
  })
  for (const args of [
    ['bad', 1, 2],
    ['nw', NaN, 1],
    ['se', 1, Infinity],
  ])
    assert.equal(resizeGroupPadding(DEFAULT_GROUP_PADDING, ...args), null)
})
