import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCanvasAutoLayout } from '../src/utils/canvasAutoLayout.js'

function assertNoOverlap(layers, layout) {
  for (let leftIndex = 0; leftIndex < layers.length; leftIndex += 1) {
    const left = layers[leftIndex]
    const leftPosition = layout.get(left.id)
    for (let rightIndex = leftIndex + 1; rightIndex < layers.length; rightIndex += 1) {
      const right = layers[rightIndex]
      const rightPosition = layout.get(right.id)
      const separated =
        leftPosition.x + left.width <= rightPosition.x ||
        rightPosition.x + right.width <= leftPosition.x ||
        leftPosition.y + left.height <= rightPosition.y ||
        rightPosition.y + right.height <= leftPosition.y
      assert.ok(separated, `${left.id} overlaps ${right.id}`)
    }
  }
}

test('places connected generations to the right of their source image', () => {
  const layers = [
    { id: 'source', x: 300, y: 200, width: 200, height: 300 },
    { id: 'result-a', x: 20, y: 20, width: 220, height: 280 },
    { id: 'result-b', x: 50, y: 600, width: 180, height: 240 },
  ]
  const layout = buildCanvasAutoLayout(
    layers,
    [
      { fromLayerId: 'source', toLayerId: 'result-a' },
      { fromLayerId: 'source', toLayerId: 'result-b' },
    ],
    { maxRows: 3 },
  )

  assert.ok(layout.get('result-a').x > layout.get('source').x)
  assert.ok(layout.get('result-b').x > layout.get('source').x)
  assert.ok(layout.get('result-b').y > layout.get('result-a').y)
  assertNoOverlap(layers, layout)
})

test('wraps a dense unconnected set into multiple columns without overlap', () => {
  const layers = Array.from({ length: 7 }, (_, index) => ({
    id: `image-${index}`,
    x: 0,
    y: 0,
    width: 200,
    height: 240,
  }))
  const layout = buildCanvasAutoLayout(layers, [], { maxRows: 3, gapX: 80, gapY: 40 })
  const xValues = new Set([...layout.values()].map((position) => position.x))

  assert.equal(layout.size, 7)
  assert.equal(xValues.size, 3)
  assert.equal(new Set([...layout.values()].map(({ x, y }) => `${x}:${y}`)).size, 7)
  assertNoOverlap(layers, layout)
})

test('keeps cyclic connections finite and deterministic', () => {
  const layers = [
    { id: 'a', x: 40, y: 20, width: 100, height: 100 },
    { id: 'b', x: 20, y: 160, width: 100, height: 100 },
  ]
  const connections = [
    { fromLayerId: 'a', toLayerId: 'b' },
    { fromLayerId: 'b', toLayerId: 'a' },
  ]

  const first = buildCanvasAutoLayout(layers, connections)
  const second = buildCanvasAutoLayout(layers, connections)

  assert.deepEqual([...first], [...second])
  assert.ok([...first.values()].every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))
  assertNoOverlap(layers, first)
})

test('uses the visible card dimensions supplied by the canvas renderer', () => {
  const layers = Array.from({ length: 5 }, (_, index) => ({
    id: `portrait-${index}`,
    x: 0,
    y: index * 420,
    width: 360,
    height: 480,
  }))
  const layout = buildCanvasAutoLayout(layers, [], { maxRows: 5, gapY: 64 })

  assertNoOverlap(layers, layout)
  assert.equal(layout.get('portrait-1').y - layout.get('portrait-0').y, 544)
})

test('arranges canvas images in fixed rows of five without overlap', () => {
  const layers = Array.from({ length: 12 }, (_, index) => ({
    id: `grid-${index}`,
    x: 120 + index * 10,
    y: 80 + index * 10,
    width: index % 2 ? 240 : 360,
    height: index % 3 ? 320 : 480,
  }))
  const layout = buildCanvasAutoLayout(layers, [], { columns: 5, gapX: 48, gapY: 40 })

  assert.equal(layout.size, 12)
  assert.equal(new Set(layers.slice(0, 5).map((layer) => layout.get(layer.id).y)).size, 2)
  assert.ok(layout.get('grid-5').y > layout.get('grid-0').y)
  assert.ok(layout.get('grid-10').y > layout.get('grid-5').y)
  assertNoOverlap(layers, layout)
})
