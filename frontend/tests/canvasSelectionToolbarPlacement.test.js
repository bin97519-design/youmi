import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasSelectionToolbarPlacement } from '../src/utils/canvasSelectionToolbarPlacement.js'

const anchor = { x: 200, y: 250, bottom: 550 }
const available = { left: 12, right: 1264, top: 72, bottom: 1000 }
const size = { width: 320, height: 48 }
const viewport = { left: 100, top: 60, scale: 0.5 }
function box(placement, view) {
  return {
    left: view.left + Number.parseFloat(placement.style.left) * view.scale,
    top: view.top + Number.parseFloat(placement.style.top) * view.scale,
    width: Math.min(size.width, Number.parseFloat(placement.style.maxWidth)),
    height: size.height,
  }
}

test('the toolbar is anchored in canvas coordinates with constant readable screen dimensions', () => {
  const result = canvasSelectionToolbarPlacement(anchor, viewport, available, size)
  const rendered = box(result, viewport)
  assert.equal(rendered.left + rendered.width / 2, viewport.left + anchor.x * viewport.scale)
  assert.equal(viewport.top + anchor.y * viewport.scale - rendered.top - rendered.height, 12)
  assert.equal(result.style.transform, 'scale(2)')
})

test('panning changes the toolbar screen position by exactly the same amount as the group', () => {
  const panned = { ...viewport, left: viewport.left + 90, top: viewport.top + 80 }
  const first = canvasSelectionToolbarPlacement(anchor, viewport, available, size)
  const second = canvasSelectionToolbarPlacement(anchor, panned, available, size)
  assert.deepEqual(first.style, second.style)
  assert.equal(box(second, panned).left - box(first, viewport).left, 90)
  assert.equal(box(second, panned).top - box(first, viewport).top, 80)
})

test('zoom keeps the toolbar centered on the group without scaling its controls or gap', () => {
  for (const scale of [0.23, 0.65, 1, 2, 4]) {
    const view = { left: 100, top: 60, scale }
    const result = canvasSelectionToolbarPlacement(anchor, view, { ...available, top: 0 }, size)
    const rendered = box(result, view)
    assert.ok(Math.abs(rendered.left + rendered.width / 2 - view.left - anchor.x * scale) < 0.001)
    assert.ok(Math.abs(view.top + anchor.y * scale - rendered.top - rendered.height - 12) < 0.001)
    assert.equal(rendered.width, 320)
    assert.equal(rendered.height, 48)
  }
})

test('a group moving offscreen takes the toolbar with it instead of pinning it to the page edge', () => {
  const view = { left: -250, top: 60, scale: 1 }
  const first = box(canvasSelectionToolbarPlacement(anchor, view, available, size), view)
  assert.equal(first.left + first.width / 2, -50)
  assert.ok(first.left < available.left)
  const farther = { ...view, left: view.left - 100 }
  const second = box(canvasSelectionToolbarPlacement(anchor, farther, available, size), farther)
  assert.equal(second.left - first.left, -100)
})

test('obstacle avoidance switches only to the group bottom rather than an unrelated screen location', () => {
  const view = { left: 0, top: 60, scale: 1 }
  const group = { x: 200, y: 100, bottom: 300 }
  const obstacles = [{ left: 0, right: 300, top: 70, bottom: 190 }]
  const result = box(canvasSelectionToolbarPlacement(group, view, available, size, obstacles), view)
  assert.equal(result.top, view.top + group.bottom + 12)
  const tight = { ...available, bottom: 350 }
  const fallback = box(canvasSelectionToolbarPlacement(group, view, tight, size, obstacles), view)
  assert.equal(view.top + group.y - fallback.top - fallback.height, 12)
})

test('the dropdown stays within the viewport even when its group toolbar is partially clipped', () => {
  const view = { left: -250, top: 60, scale: 1 }
  const result = canvasSelectionToolbarPlacement(anchor, view, available, size)
  const toolbar = box(result, view)
  const menuLeft = toolbar.left + Number.parseFloat(result.menuStyle.left) + 1
  const menuTop = toolbar.top + Number.parseFloat(result.menuStyle.top) + 1
  assert.equal(menuLeft, available.left)
  assert.ok(menuLeft + Number.parseFloat(result.menuStyle.width) <= available.right)
  assert.ok(menuTop >= available.top)
  assert.ok(menuTop + Number.parseFloat(result.menuStyle.maxHeight) <= available.bottom)
})
