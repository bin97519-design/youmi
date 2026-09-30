import test from 'node:test'
import assert from 'node:assert/strict'
import { findVisibleGenerationPlacement } from '../src/utils/canvasGenerationPlacement.js'

const viewport = { x: 0, y: 0, width: 1200, height: 900 }
const anchor = { x: 120, y: 180, width: 300, height: 300 }

function cardAt(position) {
  return { ...position, width: 240, height: 280 }
}

function overlaps(left, right) {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  )
}

test('places a generated card beside the first reference when that space is blank', () => {
  const position = findVisibleGenerationPlacement({
    viewport,
    anchor,
    occupied: [anchor],
    width: 240,
    height: 280,
  })

  assert.ok(position.x > anchor.x + anchor.width)
  assert.equal(position.y, anchor.y)
})

test('keeps every sequential batch card visible and avoids previous cards', () => {
  const occupied = [anchor]
  const generated = []
  for (let index = 0; index < 4; index += 1) {
    const position = findVisibleGenerationPlacement({
      viewport,
      anchor,
      occupied,
      width: 240,
      height: 280,
    })
    const card = cardAt(position)
    generated.forEach((previous) => assert.equal(overlaps(card, previous), false))
    assert.ok(card.x >= 0 && card.y >= 0)
    assert.ok(card.x + card.width <= viewport.width)
    assert.ok(card.y + card.height <= viewport.height)
    generated.push(card)
    occupied.push(card)
  }
})

test('centers the result when the first reference is outside the viewport', () => {
  const position = findVisibleGenerationPlacement({
    viewport,
    anchor: { x: 1800, y: 1200, width: 300, height: 300 },
    occupied: [],
    width: 240,
    height: 280,
  })

  assert.deepEqual(position, { x: 480, y: 310 })
})

test('centers the result when its source layer is hidden', () => {
  const position = findVisibleGenerationPlacement({
    viewport,
    anchor: { ...anchor, visible: false },
    width: 240,
    height: 280,
  })
  assert.deepEqual(position, { x: 480, y: 310 })
})

test('prefers the center when there is no room beside a visible source', () => {
  const source = { x: 20, y: 20, width: 200, height: 200 }
  const position = findVisibleGenerationPlacement({
    viewport,
    anchor: source,
    occupied: [
      source,
      { x: 230, y: 20, width: 260, height: 220 },
      { x: 20, y: 230, width: 240, height: 280 },
    ],
    width: 240,
    height: 280,
  })
  assert.deepEqual(position, { x: 480, y: 310 })
})

test('uses the viewport center as the fallback on a full canvas', () => {
  const position = findVisibleGenerationPlacement({
    viewport,
    anchor,
    occupied: [viewport],
    width: 240,
    height: 280,
  })
  assert.deepEqual(position, { x: 480, y: 310 })
})
